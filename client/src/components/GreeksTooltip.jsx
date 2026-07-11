// components/GreeksTooltip.jsx
import React from 'react';

export default function GreeksTooltip({ children, greeks, strike }) {
  if (!greeks) return children;
  
  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-50">
        <div className="bg-gray-900 text-white text-xs rounded-lg p-2 w-48 shadow-xl">
          <div className="font-semibold mb-1">Strike: {strike}</div>
          <div className="grid grid-cols-2 gap-1">
            <div>Δ Delta: {greeks.delta?.toFixed(3) || '-'}</div>
            <div>Γ Gamma: {greeks.gamma?.toFixed(4) || '-'}</div>
            <div>Θ Theta: {greeks.theta?.toFixed(2) || '-'}</div>
            <div>V Vega: {greeks.vega?.toFixed(2) || '-'}</div>
            <div className="col-span-2">IV: {greeks.iv || '-'}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}