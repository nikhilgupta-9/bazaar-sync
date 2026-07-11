// components/MarketStatusBadge.jsx
import React from 'react';
import { formatDateTime } from '../utils/format';

export default function MarketStatusBadge({ isOpen, isLive, nextOpen }) {
  const getStatusInfo = () => {
    if (isLive && isOpen) {
      return {
        label: 'Live',
        color: 'bg-green-100 text-green-700 border-green-300',
        icon: '●',
        iconColor: 'text-green-500',
      };
    }
    if (isOpen) {
      return {
        label: 'Market Open',
        color: 'bg-blue-100 text-blue-700 border-blue-300',
        icon: '◆',
        iconColor: 'text-blue-500',
      };
    }
    return {
      label: 'Market Closed',
      color: 'bg-gray-100 text-gray-600 border-gray-300',
      icon: '○',
      iconColor: 'text-gray-400',
    };
  };

  const status = getStatusInfo();

  return (
    <div className="flex items-center gap-3">
      <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.color}`}>
        <span className={`${status.iconColor}`}>{status.icon}</span>
        {status.label}
        {isLive && (
          <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
        )}
      </div>
      {!isOpen && nextOpen && (
        <span className="text-xs text-gray-400">
          Next open: {formatDateTime(nextOpen)}
        </span>
      )}
    </div>
  );
}