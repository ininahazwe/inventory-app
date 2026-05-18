import React, { useState, useEffect } from 'react';
//import { useNavigate } from 'react-router-dom';

interface Supply {
  id: number;
  name: string;
  purchase_date: string;
  cost: number;
  brand?: string;
  quantity: number;
  receiver_uid: string;
}

export const SuppliesPage: React.FC = () => {
  const [supplies, setSupplies] = useState<Supply[]>([]);
  const [totalCost, setTotalCost] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    purchase_date: '',
    cost: 0,
    brand: '',
    quantity: 1,
    receiver_uid: '',
  });

  //const navigate = useNavigate();

  useEffect(() => {
    fetchSupplies();
  }, []);

  const fetchSupplies = async () => {
    try {
      const response = await fetch('/api/supplies', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await response.json();
      setSupplies(data.supplies);
      setTotalCost(data.totalCost);
    } catch (error) {
      console.error('Error fetching supplies:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/supplies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(formData),
      });
      if (response.ok) {
        setShowForm(false);
        setFormData({ name: '', purchase_date: '', cost: 0, brand: '', quantity: 1, receiver_uid: '' });
        fetchSupplies();
      }
    } catch (error) {
      console.error('Error creating supply:', error);
    }
  };

  return (
    <div>
      <h1>Supplies Tracking</h1>
      <p>Total Cost: GH₵ {totalCost.toFixed(2)}</p>

      {!showForm && <button onClick={() => setShowForm(true)}>Add Supply</button>}

      {showForm && (
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
          <input
            type="date"
            value={formData.purchase_date}
            onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
            required
          />
          <input
            type="number"
            placeholder="Cost"
            value={formData.cost}
            onChange={(e) => setFormData({ ...formData, cost: parseFloat(e.target.value) })}
            required
          />
          <input
            type="text"
            placeholder="Brand"
            value={formData.brand}
            onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
          />
          <input
            type="number"
            placeholder="Quantity"
            value={formData.quantity}
            onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
            required
          />
          <input
            type="text"
            placeholder="Receiver UID"
            value={formData.receiver_uid}
            onChange={(e) => setFormData({ ...formData, receiver_uid: e.target.value })}
            required
          />
          <button type="submit">Save</button>
          <button onClick={() => setShowForm(false)}>Cancel</button>
        </form>
      )}

      <table>
        <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Purchase Date</th>
          <th>Cost</th>
          <th>Brand</th>
          <th>Quantity</th>
        </tr>
        </thead>
        <tbody>
        {supplies.map((supply) => (
          <tr key={supply.id}>
            <td>{supply.id}</td>
            <td>{supply.name}</td>
            <td>{supply.purchase_date}</td>
            <td>{supply.cost}</td>
            <td>{supply.brand}</td>
            <td>{supply.quantity}</td>
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
};
