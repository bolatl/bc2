import { Check } from 'lucide-react';
import type { PlanOption } from '../api/types';
import { planCopy, planPrice } from '../features/checkout-state';

export function PricingOptions({ plans, selectedPlan, onPlanChange, disabled }: {
  plans: PlanOption[];
  selectedPlan: string;
  onPlanChange: (plan: string) => void;
  disabled: boolean;
}) {
  const premiumSelected = selectedPlan === 'yearly';
  return <div className="plan-grid" role="radiogroup" aria-label="Choose your plan">
      <div className={`premium-plan ${premiumSelected ? 'selected' : ''}`}>
        <label className={`plan ${premiumSelected ? 'selected' : ''}`}>
          <input className="sr-only" type="radio" name="plan" aria-label="Premium" value="yearly" checked={premiumSelected} disabled={disabled} onChange={() => onPlanChange('yearly')} />
          <span className="plan-radio" aria-hidden="true">{premiumSelected && <Check size={13} />}</span>
          <span className="plan-description"><span className="plan-heading">Premium <span className="plan-default">· default</span></span><span>{planCopy.yearly.description}</span></span>
          <span className="plan-price">${planPrice('yearly', plans)}<small>/ year</small></span>
        </label>
      </div>
      <label className={`plan ${selectedPlan === 'monthly' ? 'selected' : ''}`}>
        <input className="sr-only" type="radio" name="plan" aria-label="Kintsugi" value="monthly" checked={selectedPlan === 'monthly'} disabled={disabled} onChange={() => onPlanChange('monthly')} />
        <span className="plan-radio" aria-hidden="true">{selectedPlan === 'monthly' && <Check size={13} />}</span>
        <span className="plan-description"><span className="plan-heading">Kintsugi</span><span>{planCopy.monthly.description}</span></span>
        <span className="plan-price">${planPrice('monthly', plans)}<small>/ month</small></span>
      </label>
      <label className={`plan ${selectedPlan === 'date_night' ? 'selected' : ''}`}>
        <input className="sr-only" type="radio" name="plan" aria-label="Date Night" value="date_night" checked={selectedPlan === 'date_night'} disabled={disabled} onChange={() => onPlanChange('date_night')} />
        <span className="plan-radio" aria-hidden="true">{selectedPlan === 'date_night' && <Check size={13} />}</span>
        <span className="plan-description"><span className="plan-heading">One-time add-ons</span><span>{planCopy.date_night.title}</span></span>
        <span className="plan-price">${planPrice('date_night', plans)}<small>one-time</small></span>
      </label>
    </div>;
}
