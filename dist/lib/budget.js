import { db } from "./db-stub";
function monthStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
/**
 * Compute available budget headroom across this month and next month.
 * Auto-upserts next month's budget row (same limits as this month) if missing.
 *
 * headroom = (thisMonth.limit - thisMonth.spent - thisMonth.committed)
 *          + (nextMonth.limit - nextMonth.committed)
 *
 * spentCents  = paid deals (paidAt IS NOT NULL), stored in LinkBudget
 * committed   = unpaid deals with agreedDate in that month (computed from LinkDeal)
 */
export async function getHeadroom(locale) {
    const now = new Date();
    const thisMonthStr = monthStr(now);
    const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const nextMonthStr = monthStr(nextMonthDate);
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const nextMonthStart = nextMonthDate;
    const monthAfterStart = new Date(now.getFullYear(), now.getMonth() + 2, 1);
    const thisMonthBudget = await db.linkBudget.findFirst({
        where: { locale, month: thisMonthStr },
    });
    // Auto-upsert next month's budget row (inherit limits from this month)
    if (thisMonthBudget) {
        await db.linkBudget.upsert({
            where: { locale_month: { locale, month: nextMonthStr } },
            create: {
                id: `${locale}-${nextMonthStr}`,
                locale,
                month: nextMonthStr,
                limitCents: thisMonthBudget.limitCents,
                avgPerLinkCents: thisMonthBudget.avgPerLinkCents,
                spentCents: 0,
            },
            update: {}, // don't overwrite existing values
        });
    }
    const nextMonthBudget = await db.linkBudget.findFirst({
        where: { locale, month: nextMonthStr },
    });
    // committedCents = sum of unpaid deals with agreedDate in that month
    const [thisCommitted, nextCommitted] = await Promise.all([
        db.linkDeal.aggregate({
            where: {
                paidAt: null,
                prospect: { target: { locale } },
                agreedDate: { gte: thisMonthStart, lt: nextMonthStart },
            },
            _sum: { agreedPriceCents: true },
        }),
        db.linkDeal.aggregate({
            where: {
                paidAt: null,
                prospect: { target: { locale } },
                agreedDate: { gte: nextMonthStart, lt: monthAfterStart },
            },
            _sum: { agreedPriceCents: true },
        }),
    ]);
    const thisCommittedCents = thisCommitted._sum.agreedPriceCents ?? 0;
    const nextCommittedCents = nextCommitted._sum.agreedPriceCents ?? 0;
    const thisHeadroom = thisMonthBudget
        ? Math.max(0, thisMonthBudget.limitCents - thisMonthBudget.spentCents - thisCommittedCents)
        : 0;
    const nextHeadroom = nextMonthBudget
        ? Math.max(0, nextMonthBudget.limitCents - nextCommittedCents)
        : 0;
    console.log(`[budget] ${locale} headroom: this month ${Math.round(thisHeadroom / 100)}€` +
        ` (spent=${Math.round((thisMonthBudget?.spentCents ?? 0) / 100)}€ committed=${Math.round(thisCommittedCents / 100)}€)` +
        ` + next month ${Math.round(nextHeadroom / 100)}€ (committed=${Math.round(nextCommittedCents / 100)}€)` +
        ` = total ${Math.round((thisHeadroom + nextHeadroom) / 100)}€`);
    return {
        headroomCents: thisHeadroom + nextHeadroom,
        thisMonth: {
            str: thisMonthStr,
            limitCents: thisMonthBudget?.limitCents ?? 0,
            spentCents: thisMonthBudget?.spentCents ?? 0,
            committedCents: thisCommittedCents,
        },
        nextMonth: {
            str: nextMonthStr,
            limitCents: nextMonthBudget?.limitCents ?? 0,
            committedCents: nextCommittedCents,
        },
        avgPerLinkCents: thisMonthBudget?.avgPerLinkCents ?? nextMonthBudget?.avgPerLinkCents ?? 50000,
    };
}
//# sourceMappingURL=budget.js.map