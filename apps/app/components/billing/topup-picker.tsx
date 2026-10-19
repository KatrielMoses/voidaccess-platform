"use client";

import { useEffect, useId, useState } from "react";
import { Button, Input, cn } from "@voidaccess/ui";
import {
  TOPUP_EXPIRY_MONTHS,
  TOPUP_MAX_USD,
  TOPUP_MIN_USD,
  TOPUP_QUICK_PICKS_USD,
  TOPUP_VOLUME_BONUSES,
  topupAmountError,
  topupBreakdown,
  type PlanId,
} from "@voidaccess/config";
import { billingCopy as copy, fill } from "@/content/billing";
import { num, usd } from "@/lib/billing/format";

/**
 * Pay-as-you-go top-up: any whole-dollar amount in the config range, with one-tap picks. The credit count shown is
 * config's topupBreakdown() for the user's plan, the same function the webhook uses to grant.
 * With `crypto` and method "crypto", the same rule is paid with crypto (NOWPayments) from its own, higher minimum; the
 * credits for the same dollars are the same. Each method shows one clear button.
 */
const CRYPTO_PICKS = [25, 50, 100, 250];
export function TopupPicker({
  plan,
  busy,
  onBuy,
  crypto,
  method = "card",
}: {
  plan: PlanId;
  busy: boolean;
  onBuy: (usd: number) => void;
  crypto?: { minUsd: number; busy: boolean; onBuy: (usd: number) => void };
  method?: "card" | "crypto";
}) {
  const byCrypto = method === "crypto" && crypto !== undefined;
  const minUsd = byCrypto ? crypto.minUsd : TOPUP_MIN_USD;
  const picks = byCrypto
    ? CRYPTO_PICKS.filter((v) => v >= crypto.minUsd && v <= TOPUP_MAX_USD)
    : TOPUP_QUICK_PICKS_USD;
  const [raw, setRaw] = useState(String(TOPUP_QUICK_PICKS_USD[1] ?? TOPUP_MIN_USD));
  // switching to crypto lifts an amount below the crypto minimum to that minimum
  useEffect(() => {
    if (byCrypto && !(Number(raw) >= minUsd)) setRaw(String(minUsd));
  }, [byCrypto]);
  const id = useId();
  const amount = raw.trim() === "" ? NaN : Number(raw);
  const error =
    raw.trim() === ""
      ? "empty"
      : (topupAmountError(amount) ?? (byCrypto && amount < minUsd ? "below_minimum" : null));
  const b = error ? null : topupBreakdown(amount, plan);
  const message =
    error === null
      ? null
      : error === "not_whole_dollars"
        ? copy.topups.errors.whole
        : error === "above_maximum"
          ? fill(copy.topups.errors.max, { max: usd(TOPUP_MAX_USD) })
          : fill(copy.topups.errors.min, { min: usd(minUsd) });

  return (
    <div className="flex flex-col gap-6 rounded-lg border border-line p-5 md:p-6" data-testid="topup-picker">
      <div className="flex flex-col gap-3">
        <span className="font-mono text-[12px] text-mute" id={`${id}-picks`}>
          {copy.topups.quickPicks}
        </span>
        <div role="group" aria-labelledby={`${id}-picks`} className="flex flex-wrap gap-2">
          {picks.map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={amount === v}
              onClick={() => setRaw(String(v))}
              data-testid={`topup-pick-${v}`}
              className={cn(
                "h-10 rounded-sm border px-4 font-mono text-[14px] tabular-nums transition-colors duration-300",
                amount === v
                  ? "border-paper bg-paper text-ink"
                  : "border-line text-dim hover:border-line-2 hover:text-paper",
              )}
            >
              {usd(v)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-amount`} className="text-[15px] text-dim">
          {fill(copy.topups.amountLabel, { min: usd(minUsd), max: usd(TOPUP_MAX_USD) })}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-40">
            <span
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-[15px] text-stone"
            >
              $
            </span>
            <Input
              id={`${id}-amount`}
              inputMode="numeric"
              autoComplete="off"
              value={raw}
              onChange={(e) => setRaw(e.target.value.replace(/[^\d.]/g, "").slice(0, 7))}
              aria-invalid={error !== null}
              aria-describedby={`${id}-result`}
              className="pl-8 font-mono tabular-nums"
              data-testid="topup-amount"
            />
          </div>
          {byCrypto ? (
            <Button
              variant="primary"
              disabled={error !== null}
              loading={crypto.busy}
              onClick={() => b && crypto.onBuy(b.usd)}
              data-testid="crypto-topup-buy"
            >
              {b ? fill(copy.crypto.buyTopup, { usd: usd(b.usd) }) : copy.topups.buyDisabled}
            </Button>
          ) : (
            <Button
              variant="secondary"
              disabled={error !== null}
              loading={busy}
              onClick={() => b && onBuy(b.usd)}
              data-testid="topup-buy"
            >
              {b ? fill(copy.topups.buy, { usd: usd(b.usd) }) : copy.topups.buyDisabled}
            </Button>
          )}
        </div>
        <p
          id={`${id}-result`}
          aria-live="polite"
          className="min-h-[1.5em] text-[15px]"
          data-testid="topup-result"
        >
          {b ? (
            <>
              <span className="text-paper">{fill(copy.topups.youGet, { credits: num(b.credits) })}</span>
              {b.volumeBonusPct > 0 || b.subscriberBonusPct > 0 ? (
                <span className="text-mute">
                  {" "}
                  {fill(copy.topups.breakdown, {
                    base: num(b.base),
                    bonuses: [
                      b.volumeBonusPct > 0 ? fill(copy.topups.volumeBonus, { pct: b.volumeBonusPct }) : null,
                      b.subscriberBonusPct > 0
                        ? fill(copy.topups.subscriberBonus, { pct: b.subscriberBonusPct })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" and "),
                  })}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-paper" role="alert">
              {message}
            </span>
          )}
        </p>
        {byCrypto ? (
          <p className="font-mono text-[12px] text-mute" data-testid="crypto-topup-min">
            {fill(copy.crypto.topupFrom, { min: usd(crypto.minUsd) })}
          </p>
        ) : null}
      </div>

      <p className="text-[15px] text-mute">
        {fill(copy.topups.rule, {
          bonuses: TOPUP_VOLUME_BONUSES.map((t) =>
            fill(copy.topups.ruleTier, { pct: Math.round(t.bonus * 100), from: usd(t.fromUsd) }),
          ).join(", "),
        })}{" "}
        {fill(copy.topups.expiry, { expiryMonths: TOPUP_EXPIRY_MONTHS })}
      </p>
    </div>
  );
}
