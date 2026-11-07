import { describe, expect, it } from "vitest";
import {
  DEFAULT_POINTS_CONFIG as C, calculatePoints, decodeAffiliateQr, encodeAffiliateQr, isValidCedula, monthKey,
  normalizeEcPhone, parseAmountToCents, searchKey, validatePurchaseAmount,
} from "../src/shared/domain";

describe("calculatePoints ($1 = 1 punto, redondeo hacia abajo)", () => {
  it.each([
    [1000, 10], [15000, 150], [25050, 250], [99, 0], [100, 1], [199, 1], [1, 0],
  ])("%i centavos → %i puntos", (cents, pts) => expect(calculatePoints(cents, C)).toBe(pts));
  it("respeta otras reglas", () => {
    expect(calculatePoints(25050, { pointsPerDollar: 1, rounding: "round" })).toBe(251);
    expect(calculatePoints(25001, { pointsPerDollar: 1, rounding: "ceil" })).toBe(251);
    expect(calculatePoints(1000, { pointsPerDollar: 2, rounding: "floor" })).toBe(20);
    expect(calculatePoints(1000, { pointsPerDollar: 0.5, rounding: "floor" })).toBe(5);
    expect(calculatePoints(-500, C)).toBe(0);
    expect(calculatePoints(10.5, C)).toBe(0);
  });
});

describe("parseAmountToCents", () => {
  it("parsea montos exactos", () => {
    expect(parseAmountToCents("250.50")).toBe(25050);
    expect(parseAmountToCents("250,5")).toBe(25050);
    expect(parseAmountToCents("0.1")).toBe(10);
    expect(parseAmountToCents("19.99")).toBe(1999);
    expect(parseAmountToCents(10)).toBe(1000);
  });
  it("rechaza entradas inválidas", () => {
    for (const v of ["", "abc", "1.234", "-5", "1e3", "1.2.3"]) expect(parseAmountToCents(v)).toBeNull();
  });
});

describe("validatePurchaseAmount", () => {
  it("aplica mínimo y máximo", () => {
    expect(validatePurchaseAmount(50, C).ok).toBe(false);
    expect(validatePurchaseAmount(100, C).ok).toBe(true);
    expect(validatePurchaseAmount(C.maxPurchaseCents + 1, C).ok).toBe(false);
  });
});

describe("cédula ecuatoriana", () => {
  it("valida dígito verificador", () => {
    expect(isValidCedula("1710034065")).toBe(true);
    expect(isValidCedula("0926687856")).toBe(true);
    expect(isValidCedula("1710034066")).toBe(false);
    expect(isValidCedula("9910034065")).toBe(false);
    expect(isValidCedula("171003406")).toBe(false);
  });
});

describe("QR del afiliado", () => {
  it("solo contiene un token opaco", () => {
    const token = "abcdefghijklmnopqrstuvwxyzABCDEF";
    const content = encodeAffiliateQr(token);
    expect(content).toBe("RPA1:" + token);
    expect(decodeAffiliateQr(content)).toEqual({ qrToken: token });
  });
  it("acepta códigos de afiliado escritos a mano", () => {
    expect(decodeAffiliateQr("af-abc2345")).toEqual({ code: "AF-ABC2345" });
    expect(decodeAffiliateQr("AFABC2345")).toEqual({ code: "AF-ABC2345" });
    expect(decodeAffiliateQr("https://evil.example")).toBeNull();
    expect(decodeAffiliateQr("RPA1:short")).toBeNull();
  });
});

describe("utilidades", () => {
  it("normaliza teléfonos", () => {
    expect(normalizeEcPhone("+593 99 123 4567")).toBe("0991234567");
    expect(normalizeEcPhone("099-123-4567")).toBe("0991234567");
    expect(normalizeEcPhone("022345678")).toBe("022345678");
    expect(normalizeEcPhone("12345")).toBeNull();
  });
  it("searchKey quita tildes", () => expect(searchKey("  José  Núñez ")).toBe("jose nunez"));
  it("monthKey usa hora de Ecuador (UTC-5)", () => {
    expect(monthKey(new Date("2026-12-01T03:00:00Z"))).toBe("2026-11");
    expect(monthKey(new Date("2026-12-01T06:00:00Z"))).toBe("2026-12");
  });
});
