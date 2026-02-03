// src/components/UserManagementPanel.tsx
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type User = {
  id: string;
  email: string;
  role: "user" | "admin" | "super_admin";
  created_at: string;
  created_by_email: string | null;
};

interface UserManagementPanelProps {
  onClose?: () => void;
}

export default function UserManagementPanel({ onClose }: UserManagementPanelProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const [adding, setAdding] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("list_all_users");
      if (err) throw err;
      setUsers((data as User[]) ?? []);
      setError(null);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAddUser = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = newEmail.trim().toLowerCase();

    if (!trimmed) {
      setError("Email is required");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Invalid email format");
      return;
    }

    setAdding(true);
    setError(null);
    try {
      const { error: err } = await supabase.rpc("add_user", {
        p_email: trimmed,
        p_role: newRole,
      });
      if (err) throw err;

      setNewEmail("");
      setNewRole("user");
      await load();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setError(errorMessage);
    } finally {
      setAdding(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: string): Promise<void> => {
    try {
      const { error: err } = await supabase.rpc("change_user_role", {
        p_user_id: userId,
        p_new_role: newRole,
      });
      if (err) throw err;
      setEditingUser(null);
      await load();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setError(errorMessage);
    }
  };

  const handleDeleteUser = async (userId: string, email: string): Promise<void> => {
    if (!confirm(`Delete user ${email}? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error: err } = await supabase.rpc("delete_user", {
        p_user_id: userId,
      });
      if (err) throw err;
      await load();
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : "Unknown error";
      setError(errorMessage);
    }
  };

  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;

  return (
    <div style={{ minWidth: 600 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h3 style={{ margin: 0 }}>Users</h3>
        {onClose && (
          <button className="pill" onClick={onClose}>
            Close
          </button>
        )}
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: 12,
            background: "#fee",
            color: "crimson",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 14,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Add User Form */}
      <form
        onSubmit={handleAddUser}
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr auto",
          gap: 8,
          marginBottom: 20,
          alignItems: "end",
        }}
      >
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
            Email
          </label>
          <input
            type="email"
            className="input"
            placeholder="user@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            disabled={adding}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, marginBottom: 4, fontWeight: 600 }}>
            Role
          </label>
          <select
            className="input"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "user" | "admin")}
            disabled={adding}
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button className="pill" type="submit" disabled={adding}>
          {adding ? "…" : "+ Add"}
        </button>
      </form>

      {/* Users Table */}
      <table className="table">
        <thead>
        <tr style={{ background: "#8D86C9" }}>
          <th>Email</th>
          <th style={{ width: 120 }}>Role</th>
          <th style={{ width: 130 }}>Created</th>
          <th style={{ width: 120 }}>By</th>
          <th style={{ width: 180 }}></th>
        </tr>
        </thead>
        <tbody>
        {users.length === 0 ? (
          <tr>
            <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 20 }}>
              No users yet
            </td>
          </tr>
        ) : (
          users.map((user) => (
            <tr key={user.id}>
              <td>{user.email}</td>
              <td>
                {editingUser?.id === user.id ? (
                  <select
                    className="input"
                    value={editingUser.role}
                    onChange={(e) =>
                      setEditingUser({ ...editingUser, role: e.target.value as "user" | "admin" | "super_admin" })
                    }
                    style={{ width: "100%" }}
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                ) : (
                  <span style={{ textTransform: "capitalize" }}>{user.role}</span>
                )}
              </td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>
                {new Date(user.created_at).toLocaleDateString()}
              </td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>
                {user.created_by_email || "—"}
              </td>
              <td>
                <div style={{ display: "flex", gap: 6 }}>
                  {editingUser?.id === user.id ? (
                    <>
                      <button
                        className="pill"
                        style={{ fontSize: 11, padding: "5px 8px" }}
                        onClick={() => handleChangeRole(user.id, editingUser.role)}
                      >
                        Save
                      </button>
                      <button
                        className="pill"
                        style={{
                          fontSize: 11,
                          padding: "5px 8px",
                          background: "#bbb",
                        }}
                        onClick={() => setEditingUser(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="pill"
                        style={{ fontSize: 11, padding: "5px 8px" }}
                        onClick={() => setEditingUser(user)}
                      >
                        Edit
                      </button>
                      <button
                        className="pill"
                        style={{
                          fontSize: 11,
                          padding: "5px 8px",
                          background: "#f3d0d0",
                        }}
                        onClick={() => handleDeleteUser(user.id, user.email)}
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))
        )}
        </tbody>
      </table>

      {/* Info note */}
      <div
        style={{
          marginTop: 16,
          padding: "12px 14px",
          background: "#f8f9fa",
          borderRadius: 8,
          fontSize: 12,
          color: "var(--muted)",
        }}
      >
        <strong>Note:</strong> Users must log in with Google first before they can be added here.
      </div>
    </div>
  );
}
