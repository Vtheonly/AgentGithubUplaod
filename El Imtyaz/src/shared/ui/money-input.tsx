/**
 * MoneyInput — currency input that displays DZD-formatted value but stores
 * the raw number. Use for any amount field.
 */
import { useState, useEffect } from "react";
import { Input } from "../ui/input";
import { formatDzdPlain, parseDzd } from "../../core/format/currency";

export function MoneyInput({
  value,
  onChange,
  placeholder,
  className,
  id,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => (value === 0 ? "" : formatDzdPlain(value)));

  // Keep text in sync when value changes externally.
  useEffect(() => {
    const parsed = parseDzd(text);
    if (parsed !== value) {
      setText(value === 0 ? "" : formatDzdPlain(value));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const n = parseDzd(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
        placeholder={placeholder ?? "0"}
        className={className}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        DZD
      </span>
    </div>
  );
}
