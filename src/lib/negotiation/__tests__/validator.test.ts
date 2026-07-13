import { describe, it, expect } from "vitest";
import { validate } from "../validator";
import type { Action } from "../decisor";

const counter = (price: number): Action => ({ kind: "counter", price, redirectToArticle: false, linkAttribute: "unknown" });
const accept = (price: number): Action => ({ kind: "accept", price, redirectToArticle: false, linkAttribute: "unknown" });

describe("validator — price coherence", () => {
  it("passes when body price matches counter price", () => {
    expect(
      validate({ body: "Podríamos cerrar en 200€. Un saludo.", action: counter(200), agreedDate: null }),
    ).toEqual({ ok: true, issues: [] });
  });

  it("fails when body names a different price than the counter", () => {
    const r = validate({ body: "Cerramos en 250€.", action: counter(200), agreedDate: null });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/do not all equal/);
  });

  it("fails when body names no price but counter requires one", () => {
    const r = validate({ body: "Podemos seguir adelante.", action: counter(200), agreedDate: null });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/names no price/);
  });

  it("passes when multiple instances of the same price appear", () => {
    const r = validate({
      body: "Confirmamos 200€. El precio acordado es 200€.",
      action: accept(200),
      agreedDate: null,
    });
    expect(r.ok).toBe(true);
  });

  it("accepts '200 EUR' as an alternate spelling", () => {
    const r = validate({ body: "Serían 200 EUR.", action: counter(200), agreedDate: null });
    expect(r.ok).toBe(true);
  });

  it("accepts '200 euros' as an alternate spelling", () => {
    const r = validate({ body: "El coste: 200 euros.", action: counter(200), agreedDate: null });
    expect(r.ok).toBe(true);
  });

  it("fails when decline action body names any price", () => {
    const r = validate({ body: "No podemos a 300€, gracias.", action: { kind: "decline" }, agreedDate: null });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/action decline carries none/);
  });

  it("fails when logistics action body names any price", () => {
    const r = validate({
      body: "Publicamos el martes, 200€ como acordamos.",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(false);
  });

  it("passes when logistics body names no price", () => {
    const r = validate({
      body: "¿Os viene bien publicar el martes de la semana que viene?",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(true);
  });
});

describe("validator — banned hosts", () => {
  it("fails when body contains protickets.com", () => {
    const r = validate({
      body: "Podéis enlazar a https://protickets.com/es-es/real-madrid",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("protickets.com"))).toBe(true);
  });

  it("fails when body contains hellotickets.com", () => {
    const r = validate({
      body: "enlazamos a www.hellotickets.com",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(false);
  });

  it("passes a clean body with no banned hosts", () => {
    const r = validate({
      body: "Nos coordinamos con la web del cliente.",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(true);
  });
});

describe("validator — date coherence", () => {
  it("passes when no date is agreed (any date in body is fine)", () => {
    const r = validate({
      body: "Propuesta: publicar el 2026-05-10",
      action: { kind: "logistics" },
      agreedDate: null,
    });
    expect(r.ok).toBe(true);
  });

  it("passes when body repeats the agreed date", () => {
    const r = validate({
      body: "Confirmado el 2026-05-10, gracias.",
      action: { kind: "logistics" },
      agreedDate: "2026-05-10",
    });
    expect(r.ok).toBe(true);
  });

  it("fails when body names a different date than agreedDate", () => {
    const r = validate({
      body: "Confirmado el 2026-05-12, gracias.",
      action: { kind: "logistics" },
      agreedDate: "2026-05-10",
    });
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.includes("agreedDate"))).toBe(true);
  });

  it("handles d/m/y european format vs agreedDate", () => {
    const r = validate({
      body: "Confirmado el 10/05/2026.",
      action: { kind: "logistics" },
      agreedDate: "2026-05-10",
    });
    expect(r.ok).toBe(true);
  });
});

describe("validator — empty body", () => {
  it("fails when body is empty for a sendable action", () => {
    const r = validate({ body: "", action: counter(200), agreedDate: null });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatch(/empty/);
  });

  it("fails when body is null for a sendable action", () => {
    const r = validate({ body: null, action: counter(200), agreedDate: null });
    expect(r.ok).toBe(false);
  });

  it("passes when body is null for stall", () => {
    const r = validate({ body: null, action: { kind: "stall" }, agreedDate: null });
    expect(r.ok).toBe(true);
  });

  it("passes when body is null for terminal", () => {
    const r = validate({ body: null, action: { kind: "terminal", reason: "unsubscribe" }, agreedDate: null });
    expect(r.ok).toBe(true);
  });
});
