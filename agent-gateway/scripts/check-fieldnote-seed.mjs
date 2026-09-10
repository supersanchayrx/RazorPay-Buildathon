import { buildFieldnoteSeed, fieldnoteCustomerId, normalizePhone } from "./fieldnote-seed-lib.mjs";

let failures = 0;
function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const secret = "fieldnote-check-secret";
const phone = "+919876543210";
const seed = buildFieldnoteSeed({
  name: "Demo Presenter",
  phone,
  secret,
  asOf: new Date("2026-09-10T12:00:00.000Z"),
});

check("phone normalization matches the storefront", normalizePhone("98765 43210") === phone);
check("prominent identity uses the storefront HMAC", seed.prominent.id === fieldnoteCustomerId(secret, phone));
check("prominent shopper has fourteen completed orders", seed.orders.filter((o) => o.status === "placed" && o.customer.id === seed.prominent.id).length === 14);
check("prominent shopper has six baskets", seed.carts.filter((c) => c.customer.id === seed.prominent.id).length === 6);
check("prominent shopper has several memories", seed.memories.filter((m) => m.sub === seed.prominent.id).length === 4);
check("every commerce record is labelled synthetic", [...seed.orders, ...seed.carts].every((row) => row.synthetic && row.seed === seed.seed));
check("only the controlled shopper uses the real test number", seed.profiles.filter((p) => p.phone === phone).length === 1);
check("history is substantial enough for commercial analysis", seed.orders.length >= 300 && seed.carts.length >= 100, `${seed.orders.length} orders and ${seed.carts.length} carts`);
check("supporting shoppers use distinct reserved fictional numbers", new Set(seed.profiles.slice(1).map((p) => p.phone)).size === 48 && seed.profiles.slice(1).every((p) => /^\+120255501\d{2}$/.test(p.phone)));
check("supporting shoppers have distinct names", new Set(seed.profiles.slice(1).map((p) => p.name)).size === 48);
check("all contact email domains are non-deliverable", seed.profiles.every((p) => p.email.endsWith("@example.invalid")));
check("all memory subjects belong to seeded profiles", seed.memories.every((m) => seed.profiles.some((p) => p.id === m.sub)));

console.log(failures ? `\n${failures} check(s) failed` : "\nall Fieldnote seed checks passed");
process.exit(failures ? 1 : 0);
