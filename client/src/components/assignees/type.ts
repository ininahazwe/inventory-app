export type Assignee = {
  key: string;            // email si dispo, sinon clé dérivée du nom
  full_name: string | null;
  email: string | null;
  active_count: number;
  total_count: number;
  last_assigned: string | null; // ISO
};
