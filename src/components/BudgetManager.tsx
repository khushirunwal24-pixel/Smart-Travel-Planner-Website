import React, { useState, useEffect } from 'react';
import {
  IndianRupee,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  PieChart,
  Calendar,
  Tag,
  FileText,
  Search,
  Filter,
  CheckCircle2,
  TrendingDown,
  TrendingUp,
  X,
  CreditCard,
} from 'lucide-react';
import { Trip, Expense, ExpenseCategory } from '../types';
import {
  getExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  getTrips,
} from '../services/tripService';
import { useAuth } from '../context/AuthContext';
import { formatINR } from '../utils/currency';

interface BudgetManagerProps {
  currentTrip?: Trip | null;
  onSelectTrip?: (trip: Trip) => void;
  onShowToast: (type: 'success' | 'error' | 'info', title: string, message: string) => void;
}

const CATEGORIES: ExpenseCategory[] = [
  'Transport',
  'Accommodation',
  'Food',
  'Activities',
  'Shopping',
  'Other',
];

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  Transport: '#2563EB', // Blue
  Accommodation: '#0D9488', // Teal
  Food: '#F59E0B', // Amber
  Activities: '#8B5CF6', // Purple
  Shopping: '#EC4899', // Pink
  Other: '#64748B', // Slate
};

export const BudgetManager: React.FC<BudgetManagerProps> = ({
  currentTrip,
  onSelectTrip,
  onShowToast,
}) => {
  const { user, isGuest } = useAuth();
  const userId = user?.uid || 'guest_traveler_101';

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTrip, setActiveTrip] = useState<Trip | null>(currentTrip || null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Form inputs
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>('Food');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('All');

  // Load user trips
  useEffect(() => {
    async function loadUserTrips() {
      const userTrips = await getTrips(userId, isGuest);
      setTrips(userTrips);
      if (!activeTrip && userTrips.length > 0) {
        setActiveTrip(userTrips[0]);
      }
    }
    loadUserTrips();
  }, [userId, isGuest]);

  // Load expenses whenever activeTrip changes
  useEffect(() => {
    if (!activeTrip) {
      setExpenses([]);
      setLoading(false);
      return;
    }
    async function loadTripExpenses() {
      setLoading(true);
      try {
        const list = await getExpenses(activeTrip!.id, userId, isGuest);
        setExpenses(list);
      } catch (err) {
        console.error('Failed to load expenses:', err);
      } finally {
        setLoading(false);
      }
    }
    loadTripExpenses();
  }, [activeTrip, userId, isGuest]);

  // Calculate totals
  const totalBudget = activeTrip?.budget || 0;
  const totalSpent = expenses.reduce((sum, e) => sum + (e.amount || 0), 0);
  const remainingBudget = totalBudget - totalSpent;
  const spendingPercentage = totalBudget > 0 ? Math.min(200, Math.round((totalSpent / totalBudget) * 100)) : 0;
  const isOverBudget = remainingBudget < 0;

  // Category breakdown
  const categorySpending: Record<ExpenseCategory, number> = {
    Transport: 0,
    Accommodation: 0,
    Food: 0,
    Activities: 0,
    Shopping: 0,
    Other: 0,
  };

  expenses.forEach((e) => {
    if (categorySpending[e.category] !== undefined) {
      categorySpending[e.category] += e.amount;
    } else {
      categorySpending['Other'] += e.amount;
    }
  });

  const handleOpenAddModal = () => {
    setEditingExpense(null);
    setTitle('');
    setAmount('');
    setCategory('Food');
    setDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setModalOpen(true);
  };

  const handleOpenEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setTitle(exp.title);
    setAmount(exp.amount.toString());
    setCategory(exp.category);
    setDate(exp.date);
    setNotes(exp.notes || '');
    setModalOpen(true);
  };

  const handleSaveExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTrip) {
      onShowToast('error', 'Error', 'Please select or create a trip first.');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (!title.trim() || isNaN(parsedAmount) || parsedAmount <= 0) {
      onShowToast('error', 'Validation Error', 'Please enter a valid title and positive amount.');
      return;
    }

    try {
      if (editingExpense) {
        await updateExpense(
          editingExpense.id,
          {
            title: title.trim(),
            amount: parsedAmount,
            category,
            date,
            notes: notes.trim(),
          },
          isGuest
        );
        setExpenses((prev) =>
          prev.map((item) =>
            item.id === editingExpense.id
              ? {
                  ...item,
                  title: title.trim(),
                  amount: parsedAmount,
                  category,
                  date,
                  notes: notes.trim(),
                }
              : item
          )
        );
        onShowToast('success', 'Updated', 'Expense updated successfully.');
      } else {
        const created = await addExpense(
          {
            tripId: activeTrip.id,
            userId,
            title: title.trim(),
            amount: parsedAmount,
            category,
            date,
            notes: notes.trim(),
          },
          isGuest
        );
        setExpenses((prev) => [created, ...prev]);
        onShowToast('success', 'Added', 'New expense logged to budget.');
      }
      setModalOpen(false);
    } catch (err: any) {
      onShowToast('error', 'Save Failed', err?.message || 'Could not save expense.');
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Are you sure you want to delete this expense record?')) return;
    try {
      await deleteExpense(expenseId, isGuest);
      setExpenses((prev) => prev.filter((e) => e.id !== expenseId));
      onShowToast('info', 'Deleted', 'Expense item removed.');
    } catch (err: any) {
      onShowToast('error', 'Error', 'Failed to delete expense.');
    }
  };

  // Filtered expenses list
  const filteredExpenses = expenses.filter((e) => {
    const matchesSearch =
      e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.notes && e.notes.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCat =
      selectedCategoryFilter === 'All' || e.category === selectedCategoryFilter;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header & Trip Selector */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-teal-600 mb-1">
            <IndianRupee className="w-4 h-4" />
            <span>Financial Control & Real-Time Expense Analytics</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 font-heading">
            Trip Budget Management
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Track allocations, monitor expenditures, and prevent unexpected overspending.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {trips.length > 0 && (
            <select
              value={activeTrip?.id || ''}
              onChange={(e) => {
                const found = trips.find((t) => t.id === e.target.value);
                if (found) {
                  setActiveTrip(found);
                  onSelectTrip?.(found);
                }
              }}
              className="py-2 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-slate-50 focus:outline-none cursor-pointer"
            >
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.destination})
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleOpenAddModal}
            className="py-2 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-sm shadow-blue-500/20 cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      </div>

      {/* Warning Banner if Over Budget */}
      {isOverBudget && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 animate-fade-in shadow-xs">
          <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <h4 className="font-bold text-rose-900 text-sm">Budget Exceeded Alert</h4>
            <p className="mt-0.5">
              You have exceeded your planned budget of <strong>{formatINR(totalBudget)}</strong> by{' '}
              <strong className="underline">{formatINR(Math.abs(remainingBudget))}</strong>. Consider trimming upcoming activity costs or adjusting your budget limit.
            </p>
          </div>
        </div>
      )}

      {/* Metric Cards (Total Budget, Actual Spending, Remaining Budget, Health) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Budget */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Total Estimated Budget
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 font-heading">
              {formatINR(totalBudget)}
            </div>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <IndianRupee className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">Target expenditure ceiling</p>
        </div>

        {/* Actual Spending */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Actual Spending
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="text-2xl font-extrabold text-slate-900 font-heading">
              {formatINR(totalSpent)}
            </div>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{expenses.length} transactions recorded</p>
        </div>

        {/* Remaining Budget */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Remaining Balance
          </span>
          <div className="mt-2 flex items-baseline justify-between">
            <div
              className={`text-2xl font-extrabold font-heading ${
                isOverBudget ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {formatINR(remainingBudget)}
            </div>
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                isOverBudget ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {isOverBudget ? <AlertTriangle className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {isOverBudget ? 'Deficit over limit' : 'Available for remaining days'}
          </p>
        </div>

        {/* Budget Burn Progress */}
        <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 mb-1">
              <span>Budget Utilized</span>
              <span className={spendingPercentage > 100 ? 'text-rose-600' : 'text-slate-900'}>
                {spendingPercentage}%
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  spendingPercentage > 100
                    ? 'bg-rose-500'
                    : spendingPercentage > 85
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-blue-600 to-teal-500'
                }`}
                style={{ width: `${Math.min(100, spendingPercentage)}%` }}
              />
            </div>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            {spendingPercentage > 100
              ? 'Warning: Limit exceeded'
              : spendingPercentage > 80
              ? 'Approaching limit'
              : 'Healthy pace'}
          </p>
        </div>
      </div>

      {/* Category Breakdown Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Category Spending Bars */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 font-heading">
              Category-Wise Spending Breakdown
            </h3>
            <span className="text-xs text-slate-400">Total: {formatINR(totalSpent)}</span>
          </div>

          <div className="space-y-3 pt-2">
            {CATEGORIES.map((cat) => {
              const amountCat = categorySpending[cat];
              const pct = totalSpent > 0 ? Math.round((amountCat / totalSpent) * 100) : 0;
              const color = CATEGORY_COLORS[cat];

              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                      {cat}
                    </span>
                    <span className="text-slate-900 font-bold">
                      {formatINR(amountCat)}{' '}
                      <span className="text-slate-400 text-[11px] font-normal">({pct}%)</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Quick Travel Budget Tips */}
        <div className="bg-slate-900 text-white p-6 rounded-3xl shadow-xl flex flex-col justify-between">
          <div>
            <div className="w-10 h-10 rounded-2xl bg-teal-500/20 text-teal-400 flex items-center justify-center mb-3">
              <PieChart className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold font-heading">Smart Budget Optimizer</h3>
            <p className="text-xs text-slate-300 mt-2 leading-relaxed">
              Based on your destination and traveler count, standard budget allocations recommend:
            </p>
            <div className="mt-4 space-y-2 text-xs text-slate-300">
              <div className="flex justify-between border-b border-slate-800 pb-1.5">
                <span>Accommodation & Stays</span>
                <span className="font-semibold text-teal-400">35% - 40%</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1.5">
                <span>Flights / Transit</span>
                <span className="font-semibold text-blue-400">25% - 30%</span>
              </div>
              <div className="flex justify-between border-b border-slate-800 pb-1.5">
                <span>Food & Dining</span>
                <span className="font-semibold text-amber-400">20%</span>
              </div>
              <div className="flex justify-between pb-1.5">
                <span>Activities & Souvenirs</span>
                <span className="font-semibold text-pink-400">10% - 15%</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800 text-[11px] text-slate-400">
            Keep receipts photographed and logged daily to avoid surprise bank exchange charges.
          </div>
        </div>
      </div>

      {/* Expense History Table with Search and Filters */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xs overflow-hidden">
        {/* Table Filters Toolbar */}
        <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-900 font-heading">Expense History</h3>
            <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
              {filteredExpenses.length} items
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search expense..."
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Category Filter */}
            <select
              value={selectedCategoryFilter}
              onChange={(e) => setSelectedCategoryFilter(e.target.value)}
              className="py-1.5 px-3 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 bg-slate-50 focus:outline-none cursor-pointer"
            >
              <option value="All">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-semibold border-b border-slate-100">
              <tr>
                <th className="py-3 px-4">Title & Item</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Notes</th>
                <th className="py-3 px-4 text-right">Amount</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-slate-50/70 transition-colors">
                  <td className="py-3.5 px-4 font-semibold text-slate-900">{exp.title}</td>
                  <td className="py-3.5 px-4">
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white"
                      style={{ backgroundColor: CATEGORY_COLORS[exp.category] || '#64748B' }}
                    >
                      {exp.category}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-slate-500">{exp.date}</td>
                  <td className="py-3.5 px-4 text-slate-500 max-w-xs truncate">{exp.notes || '—'}</td>
                  <td className="py-3.5 px-4 text-right font-bold text-slate-900">
                    {formatINR(exp.amount)}
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        onClick={() => handleOpenEditModal(exp)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        title="Edit expense"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteExpense(exp.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Delete expense"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400 text-xs">
                    <IndianRupee className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    No expenses found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Expense Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-100 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-teal-500 p-6 text-white relative">
              <button
                onClick={() => setModalOpen(false)}
                className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
              <h3 className="text-lg font-bold font-heading">
                {editingExpense ? 'Edit Expense Record' : 'Log New Expense'}
              </h3>
              <p className="text-xs text-blue-100 mt-1">
                Trip: {activeTrip?.title || 'Selected Trip'}
              </p>
            </div>

            <form onSubmit={handleSaveExpense} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Expense Title / Item Name
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Louvre Museum Tickets, Dinner Bistro"
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Amount (₹)
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="e.g. 3500"
                    required
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600 cursor-pointer"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Paid in EUR via credit card"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/20"
                >
                  {editingExpense ? 'Save Changes' : 'Add Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
