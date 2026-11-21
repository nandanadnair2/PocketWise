// Shows an amount in paise as ₹1,234.56 with the decimals smaller and lighter,
// like the big amounts in the reference designs. Use it anywhere a balance or price appears.

export default function Money({
  paise,
  className = "",
  decimalsClassName = "text-[0.55em] font-medium opacity-60",
}: {
  paise: number;
  className?: string;
  decimalsClassName?: string;
}) {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100);
  const cents = String(abs % 100).padStart(2, "0");
  return (
    <span className={className}>
      {paise < 0 ? "−" : ""}₹{whole.toLocaleString("en-IN")}
      <span className={decimalsClassName}>.{cents}</span>
    </span>
  );
}
