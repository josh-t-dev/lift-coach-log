import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
};

/**
 * A number box for required values. It lets the field be empty while you
 * type (so clearing "0" and typing 45 gives 45, not 045), saves each valid
 * number as you go, and snaps back to the saved value when you leave it.
 */
export function NumInput({ value, onChange, min, max, onFocus, onBlur, ...rest }: Props) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={text}
      onFocus={(e) => {
        editing.current = true;
        onFocus?.(e);
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(clamp(n));
      }}
      onBlur={(e) => {
        editing.current = false;
        setText(String(value));
        onBlur?.(e);
      }}
    />
  );
}
