import React from 'react';

interface IncidentBadgeProps {
  type: 'type' | 'severity' | 'status';
  value: string;
}

export const IncidentBadge: React.FC<IncidentBadgeProps> = ({ type, value }) => {
  let label = value;
  let bgColor = '#f4f1ee';
  let textColor = 'var(--ink)';

  if (type === 'type') {
    switch (value) {
      case 'damage':
        label = 'Damage';
        bgColor = '#fee2e2';
        textColor = '#991b1b';
        break;
      case 'loss':
        label = 'Loss';
        bgColor = '#fce7f3';
        textColor = '#831843';
        break;
      case 'malfunction':
        label = 'Malfunction';
        bgColor = '#fef3c7';
        textColor = '#92400e';
        break;
      case 'theft':
        label = 'Theft';
        bgColor = '#f3e8ff';
        textColor = '#6b21a8';
        break;
      case 'other':
        label = 'Other';
        bgColor = '#f4f1ee';
        textColor = 'var(--ink)';
        break;
      default:
        label = value.charAt(0).toUpperCase() + value.slice(1);
    }
  } else if (type === 'severity') {
    switch (value) {
      case 'low':
        label = 'Low';
        bgColor = '#dcfce7';
        textColor = '#166534';
        break;
      case 'medium':
        label = 'Medium';
        bgColor = '#fef08a';
        textColor = '#713f12';
        break;
      case 'high':
        label = 'High';
        bgColor = '#fed7aa';
        textColor = '#92400e';
        break;
      case 'critical':
        label = 'Critical';
        bgColor = '#fecaca';
        textColor = '#7f1d1d';
        break;
      default:
        label = value.charAt(0).toUpperCase() + value.slice(1);
    }
  } else if (type === 'status') {
    switch (value) {
      case 'open':
        label = 'Open';
        bgColor = '#bfdbfe';
        textColor = '#1e3a8a';
        break;
      case 'in_progress':
        label = 'In progress';
        bgColor = '#fde68a';
        textColor = '#713f12';
        break;
      case 'resolved':
        label = 'Resolved';
        bgColor = '#bbf7d0';
        textColor = '#166534';
        break;
      case 'closed':
        label = 'Closed';
        bgColor = '#e5e7eb';
        textColor = '#374151';
        break;
      default:
        label = value.charAt(0).toUpperCase() + value.slice(1);
    }
  }

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        backgroundColor: bgColor,
        color: textColor,
        borderRadius: '6px',
        fontSize: '12px',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};
