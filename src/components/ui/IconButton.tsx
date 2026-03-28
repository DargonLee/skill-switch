import type { ButtonHTMLAttributes, ReactNode } from "react";
import s from "./IconButton.module.css";

type IconButtonVariant = "default" | "danger" | "success" | "primary";
type IconButtonSize = "sm" | "md";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export function IconButton({
  icon,
  variant = "default",
  size = "md",
  className = "",
  type = "button",
  ...props
}: IconButtonProps) {
  const sizeClass = size === "sm" ? s.sizeSm : s.sizeMd;
  const variantClass = variant === "danger" ? s.danger
    : variant === "success" ? s.success
    : variant === "primary" ? s.primary
    : "";

  return (
    <button
      type={type}
      className={[s.button, sizeClass, variantClass, className].filter(Boolean).join(" ")}
      {...props}
    >
      {icon}
    </button>
  );
}