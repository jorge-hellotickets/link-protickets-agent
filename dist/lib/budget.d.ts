export interface Headroom {
    headroomCents: number;
    thisMonth: {
        str: string;
        limitCents: number;
        spentCents: number;
        committedCents: number;
    };
    nextMonth: {
        str: string;
        limitCents: number;
        committedCents: number;
    };
    avgPerLinkCents: number;
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
export declare function getHeadroom(locale: string): Promise<Headroom>;
//# sourceMappingURL=budget.d.ts.map