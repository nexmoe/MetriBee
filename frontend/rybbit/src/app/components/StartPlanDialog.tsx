"use client";
import { PlanDialog } from "@/components/subscription/components/PlanDialog";
export function StartPlanDialog({open,onOpenChange}: {open:boolean;onOpenChange:(open:boolean)=>void;organizationId:string;returnPath:string;trialEligible:boolean;onDone?:()=>void}) {
  return <PlanDialog open={open} onOpenChange={onOpenChange}/>;
}
