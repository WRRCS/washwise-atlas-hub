import { Input } from "@/components/ui/input";

export function PropertyTypeField({ value, saved, disabled, onChange }: {
  value: string; saved: boolean; disabled?: boolean; onChange: (value: string) => void;
}) {
  return <Input aria-label="Property type" value={value} readOnly={saved} disabled={disabled} maxLength={60}
    placeholder="Residence, Airbnb, Office…" onChange={(event) => onChange(event.target.value)} />;
}