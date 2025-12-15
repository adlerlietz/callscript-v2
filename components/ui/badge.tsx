import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-zinc-800 text-zinc-300 ring-zinc-700",
        success: "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20",
        warning: "bg-amber-500/10 text-amber-400 ring-amber-500/20",
        danger: "bg-red-500/10 text-red-400 ring-red-500/20",
        info: "bg-blue-500/10 text-blue-400 ring-blue-500/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
