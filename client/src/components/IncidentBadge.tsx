// src/components/IncidentBadge.tsx
import React from 'react';

interface IncidentBadgeProps {
  type: 'status' | 'severity' | 'type';
  value: string;
}

export const IncidentBadge: React.FC<IncidentBadgeProps> = ({ type, value }) => {
  const getBadgeClass = () => {
    if (type === 'status') {
      switch (value) {
        case 'open':
          return 'incident-badge incident-badge--open';
        case 'in_progress':
          return 'incident-badge incident-badge--in-progress';
        case 'resolved':
          return 'incident-badge incident-badge--resolved';
        case 'closed':
          return 'incident-badge incident-badge--closed';
        default:
          return 'incident-badge';
      }
    }

    if (type === 'severity') {
      switch (value) {
        case 'low':
          return 'incident-badge incident-badge--low';
        case 'medium':
          return 'incident-badge incident-badge--medium';
        case 'high':
          return 'incident-badge incident-badge--high';
        case 'critical':
          return 'incident-badge incident-badge--critical';
        default:
          return 'incident-badge';
      }
    }

    if (type === 'type') {
      switch (value) {
        case 'damage':
          return 'incident-badge incident-badge--damage';
        case 'loss':
          return 'incident-badge incident-badge--loss';
        case 'malfunction':
          return 'incident-badge incident-badge--malfunction';
        case 'theft':
          return 'incident-badge incident-badge--theft';
        case 'other':
          return 'incident-badge incident-badge--other';
        default:
          return 'incident-badge';
      }
    }

    return 'incident-badge';
  };

  const getDisplayLabel = () => {
    const labels: Record<string, string> = {
      // Status
      'open': 'Open',
      'in_progress': 'In progress',
      'resolved': 'Resolved',
      'closed': 'Closed',
      // Severity
      'low': 'Low',
      'medium': 'Medium',
      'high': 'High',
      'critical': 'Critical',
      // Type
      'damage': 'Damage',
      'loss': 'Loss',
      'malfunction': 'Malfunction',
      'theft': 'Theft',
      'other': 'Other',
    };
    return labels[value] || value;
  };

  return (
    <span className={getBadgeClass()}>
      {getDisplayLabel()}
    </span>
  );
};
