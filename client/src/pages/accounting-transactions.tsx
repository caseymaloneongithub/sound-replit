import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { StaffLayout } from "@/components/staff/staff-layout";
import { 
  Receipt, 
  Search,
  Filter,
  Upload,
  Download,
  Tags,
  Split,
  CheckCircle,
  XCircle,
  Calendar as CalendarIcon,
  Loader2,
  MoreHorizontal,
  FileSpreadsheet,
  Plus,
  ArrowUp,
  ArrowDown,
  ArrowUpDown
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AccountingCategory, AccountingTransaction, TransactionAllocation } from "@shared/schema";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD' 
  }).format(amount);
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

interface TransactionWithAllocation extends AccountingTransaction {
  allocations?: TransactionAllocation[];
}

export default function AccountingTransactions() {
  const { toast } = useToast();
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const initialFilter = urlParams.get('filter') || 'all';
  const initialCategoryId = urlParams.get('categoryId') || 'all';
  const initialStartDate = urlParams.get('startDate');
  const initialEndDate = urlParams.get('endDate');

  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategoryId);
  const [allocationFilter, setAllocationFilter] = useState<string>(initialFilter);
  const [dateFrom, setDateFrom] = useState<Date | undefined>(initialStartDate ? new Date(initialStartDate) : undefined);
  const [dateTo, setDateTo] = useState<Date | undefined>(initialEndDate ? new Date(initialEndDate) : undefined);
  const [selectedTransactions, setSelectedTransactions] = useState<string[]>([]);
  const [allocateDialogOpen, setAllocateDialogOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<TransactionWithAllocation | null>(null);
  const [allocateCategory, setAllocateCategory] = useState<string>("");
  const [splitAllocations, setSplitAllocations] = useState<{ categoryId: string; amount: string }[]>([]);
  
  // Manual transaction form state
  const [newTxDate, setNewTxDate] = useState<Date | undefined>(new Date());
  const [newTxDescription, setNewTxDescription] = useState("");
  const [newTxAmount, setNewTxAmount] = useState("");
  const [newTxType, setNewTxType] = useState<"income" | "expense">("expense");
  const [newTxCategory, setNewTxCategory] = useState<string>("");
  
  // Sort state
  type SortField = 'date' | 'name' | 'amount' | 'category';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: transactions = [], isLoading: transactionsLoading, refetch } = useQuery<TransactionWithAllocation[]>({
    queryKey: ['/api/accounting/transactions', { 
      search: searchQuery,
      categoryId: categoryFilter !== 'all' ? categoryFilter : undefined,
      allocated: allocationFilter === 'allocated' ? 'true' : allocationFilter === 'unallocated' ? 'false' : undefined,
      startDate: dateFrom?.toISOString(),
      endDate: dateTo?.toISOString()
    }],
  });

  const { data: categories = [] } = useQuery<AccountingCategory[]>({
    queryKey: ['/api/accounting/categories'],
  });

  const allocateMutation = useMutation({
    mutationFn: async ({ transactionId, categoryId }: { transactionId: string; categoryId: string }) => {
      return apiRequest('POST', `/api/accounting/transactions/${transactionId}/allocate`, { categoryId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/summary'] });
      toast({ title: "Transaction allocated successfully" });
      setAllocateDialogOpen(false);
      setAllocateCategory("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to allocate transaction", description: error.message, variant: "destructive" });
    }
  });

  const splitMutation = useMutation({
    mutationFn: async ({ transactionId, allocations }: { transactionId: string; allocations: { categoryId: string; amount: number }[] }) => {
      return apiRequest('POST', `/api/accounting/transactions/${transactionId}/split`, { allocations });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/summary'] });
      toast({ title: "Transaction split successfully" });
      setSplitDialogOpen(false);
      setSplitAllocations([]);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to split transaction", description: error.message, variant: "destructive" });
    }
  });

  const bulkAllocateMutation = useMutation({
    mutationFn: async ({ transactionIds, categoryId }: { transactionIds: string[]; categoryId: string }) => {
      return apiRequest('POST', '/api/accounting/transactions/bulk-allocate', { transactionIds, categoryId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/summary'] });
      toast({ title: "Transactions allocated successfully" });
      setSelectedTransactions([]);
      setAllocateCategory("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to bulk allocate", description: error.message, variant: "destructive" });
    }
  });

  const importMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/accounting/transactions/import', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Import failed');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      toast({ title: "Import successful", description: `Imported ${data.imported} transactions` });
      setImportDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    }
  });

  const createTransactionMutation = useMutation({
    mutationFn: async (data: { date: Date; name: string; amount: string; categoryId?: string }) => {
      const transaction = await apiRequest('POST', '/api/accounting/transactions', {
        date: data.date.toISOString(),
        name: data.name,
        amount: data.amount,
        isManualImport: true
      });
      
      // If category selected, also allocate immediately
      if (data.categoryId && transaction.id) {
        await apiRequest('POST', `/api/accounting/transactions/${transaction.id}/allocate`, {
          categoryId: data.categoryId
        });
      }
      
      return transaction;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/summary'] });
      toast({ title: "Transaction added successfully" });
      setAddDialogOpen(false);
      resetAddForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add transaction", description: error.message, variant: "destructive" });
    }
  });

  const resetAddForm = () => {
    setNewTxDate(new Date());
    setNewTxDescription("");
    setNewTxAmount("");
    setNewTxType("expense");
    setNewTxCategory("");
  };

  const handleAddTransaction = () => {
    if (!newTxDate || !newTxDescription || !newTxAmount) {
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    
    const amount = parseFloat(newTxAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: "Please enter a valid amount", variant: "destructive" });
      return;
    }
    
    // Expenses are stored as positive amounts (Plaid convention), income as negative
    const signedAmount = newTxType === "expense" ? amount.toString() : (-amount).toString();
    
    createTransactionMutation.mutate({
      date: newTxDate,
      name: newTxDescription,
      amount: signedAmount,
      categoryId: newTxCategory && newTxCategory !== "none" ? newTxCategory : undefined
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append('file', file);
      importMutation.mutate(formData);
    }
  };

  const toggleSelectAll = () => {
    if (selectedTransactions.length === sortedTransactions.length) {
      setSelectedTransactions([]);
    } else {
      setSelectedTransactions(sortedTransactions.map(t => t.id));
    }
  };

  const toggleSelect = (id: string) => {
    if (selectedTransactions.includes(id)) {
      setSelectedTransactions(selectedTransactions.filter(t => t !== id));
    } else {
      setSelectedTransactions([...selectedTransactions, id]);
    }
  };

  const openAllocateDialog = (transaction: TransactionWithAllocation) => {
    setSelectedTransaction(transaction);
    setAllocateDialogOpen(true);
  };

  const openSplitDialog = (transaction: TransactionWithAllocation) => {
    setSelectedTransaction(transaction);
    setSplitAllocations([{ categoryId: '', amount: '' }]);
    setSplitDialogOpen(true);
  };

  const handleAllocate = () => {
    if (selectedTransaction && allocateCategory) {
      allocateMutation.mutate({ transactionId: selectedTransaction.id, categoryId: allocateCategory });
    }
  };

  const handleSplit = () => {
    if (selectedTransaction && splitAllocations.length > 0) {
      const allocations = splitAllocations
        .filter(a => a.categoryId && a.amount)
        .map(a => ({ categoryId: a.categoryId, amount: parseFloat(a.amount) }));
      
      if (allocations.length > 0) {
        const transactionAmount = Math.abs(parseFloat(selectedTransaction.amount));
        const allocationsSum = allocations.reduce((sum, a) => sum + Math.abs(a.amount), 0);
        
        if (Math.abs(transactionAmount - allocationsSum) > 0.01) {
          toast({
            title: "Allocation amounts must equal transaction amount",
            description: `Transaction: $${transactionAmount.toFixed(2)}, Allocations: $${allocationsSum.toFixed(2)}`,
            variant: "destructive"
          });
          return;
        }
        
        splitMutation.mutate({ transactionId: selectedTransaction.id, allocations });
      }
    }
  };

  const handleBulkAllocate = () => {
    if (selectedTransactions.length > 0 && allocateCategory) {
      bulkAllocateMutation.mutate({ transactionIds: selectedTransactions, categoryId: allocateCategory });
    }
  };

  const addSplitRow = () => {
    setSplitAllocations([...splitAllocations, { categoryId: '', amount: '' }]);
  };

  const updateSplitRow = (index: number, field: 'categoryId' | 'amount', value: string) => {
    const updated = [...splitAllocations];
    updated[index][field] = value;
    setSplitAllocations(updated);
  };

  const removeSplitRow = (index: number) => {
    setSplitAllocations(splitAllocations.filter((_, i) => i !== index));
  };

  const clearFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setAllocationFilter("all");
    setDateFrom(undefined);
    setDateTo(undefined);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-4 h-4 ml-1 opacity-50" />;
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="w-4 h-4 ml-1" />
      : <ArrowDown className="w-4 h-4 ml-1" />;
  };

  const sortedTransactions = [...transactions].sort((a, b) => {
    const getCategoryName = (tx: TransactionWithAllocation) => {
      if (tx.allocations && tx.allocations.length > 0) {
        const cat = categories.find(c => c.id === tx.allocations![0].categoryId);
        return cat?.name || '';
      }
      return '';
    };

    let comparison = 0;
    switch (sortField) {
      case 'date':
        comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
        break;
      case 'name':
        comparison = (a.name || '').localeCompare(b.name || '');
        break;
      case 'amount':
        comparison = parseFloat(a.amount) - parseFloat(b.amount);
        break;
      case 'category':
        comparison = getCategoryName(a).localeCompare(getCategoryName(b));
        break;
    }
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  const handleExportCSV = () => {
    if (transactions.length === 0) {
      toast({ title: "No transactions to export", variant: "destructive" });
      return;
    }

    const getCategoryName = (tx: TransactionWithAllocation) => {
      if (tx.allocations && tx.allocations.length > 0) {
        return tx.allocations.map(a => {
          const cat = categories.find(c => c.id === a.categoryId);
          return cat?.name || 'Unknown';
        }).join('; ');
      }
      return '';
    };

    const headers = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Allocation Status', 'Transaction Status', 'Account'];
    const rows = transactions.map(tx => {
      const amount = parseFloat(tx.amount);
      const type = amount > 0 ? 'Expense' : 'Income';
      const displayAmount = Math.abs(amount).toFixed(2);
      const allocationStatus = tx.allocations && tx.allocations.length > 0 ? 'Allocated' : 'Unallocated';
      const transactionStatus = tx.status || 'active';
      const category = getCategoryName(tx);
      const account = tx.plaidAccountId || '';
      
      return [
        new Date(tx.date).toLocaleDateString('en-US'),
        `"${(tx.name || '').replace(/"/g, '""')}"`,
        displayAmount,
        type,
        `"${category.replace(/"/g, '""')}"`,
        allocationStatus,
        transactionStatus,
        account
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    link.download = `transactions-${dateStr}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    toast({ title: `Exported ${transactions.length} transactions` });
  };

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="heading-transactions">
              Transactions
            </h1>
            <p className="text-muted-foreground">
              View and categorize financial transactions
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setAddDialogOpen(true)} data-testid="button-add-transaction">
              <Plus className="w-4 h-4 mr-2" />
              Add Transaction
            </Button>
            <Button 
              variant="outline" 
              onClick={handleExportCSV}
              disabled={transactions.length === 0 || transactionsLoading}
              data-testid="button-export-csv"
            >
              <Download className="w-4 h-4 mr-2" />
              Export CSV
            </Button>
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-import-csv">
                  <Upload className="w-4 h-4 mr-2" />
                  Import CSV
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import Transactions</DialogTitle>
                  <DialogDescription>
                    Upload a CSV file with transaction data. Expected columns: date, description, amount, type (income/expense).
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="border-2 border-dashed rounded-lg p-6 text-center">
                    <FileSpreadsheet className="w-10 h-10 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Drag and drop your CSV file here, or click to browse
                    </p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importMutation.isPending}
                    >
                      {importMutation.isPending ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        "Select File"
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Filter className="h-5 w-5" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-2">
                <Label>Search</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search transactions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    data-testid="input-search"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger data-testid="select-category-filter">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={allocationFilter} onValueChange={setAllocationFilter}>
                  <SelectTrigger data-testid="select-allocation-filter">
                    <SelectValue placeholder="All transactions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All transactions</SelectItem>
                    <SelectItem value="allocated">Allocated</SelectItem>
                    <SelectItem value="unallocated">Unallocated</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>From Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}
                      data-testid="button-date-from"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, "MMM d, yyyy") : "Start date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>To Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !dateTo && "text-muted-foreground")}
                      data-testid="button-date-to"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, "MMM d, yyyy") : "End date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="button-clear-filters">
                Clear Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedTransactions.length > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {selectedTransactions.length} transaction{selectedTransactions.length > 1 ? 's' : ''} selected
                </span>
                <div className="flex gap-2">
                  <Select value={allocateCategory} onValueChange={setAllocateCategory}>
                    <SelectTrigger className="w-[200px]" data-testid="select-bulk-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button 
                    onClick={handleBulkAllocate} 
                    disabled={!allocateCategory || bulkAllocateMutation.isPending}
                    data-testid="button-bulk-allocate"
                  >
                    {bulkAllocateMutation.isPending ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Tags className="w-4 h-4 mr-2" />
                    )}
                    Allocate Selected
                  </Button>
                  <Button variant="outline" onClick={() => setSelectedTransactions([])}>
                    Clear Selection
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="p-4 text-left">
                      <Checkbox 
                        checked={selectedTransactions.length === sortedTransactions.length && sortedTransactions.length > 0}
                        onCheckedChange={toggleSelectAll}
                        data-testid="checkbox-select-all"
                      />
                    </th>
                    <th className="p-4 text-left text-sm font-medium">
                      <button 
                        onClick={() => handleSort('date')}
                        className="flex items-center hover:text-primary transition-colors"
                        data-testid="sort-date"
                      >
                        Date
                        {getSortIcon('date')}
                      </button>
                    </th>
                    <th className="p-4 text-left text-sm font-medium">
                      <button 
                        onClick={() => handleSort('name')}
                        className="flex items-center hover:text-primary transition-colors"
                        data-testid="sort-description"
                      >
                        Description
                        {getSortIcon('name')}
                      </button>
                    </th>
                    <th className="p-4 text-left text-sm font-medium">
                      <button 
                        onClick={() => handleSort('category')}
                        className="flex items-center hover:text-primary transition-colors"
                        data-testid="sort-category"
                      >
                        Category
                        {getSortIcon('category')}
                      </button>
                    </th>
                    <th className="p-4 text-right text-sm font-medium">
                      <button 
                        onClick={() => handleSort('amount')}
                        className="flex items-center justify-end hover:text-primary transition-colors w-full"
                        data-testid="sort-amount"
                      >
                        Amount
                        {getSortIcon('amount')}
                      </button>
                    </th>
                    <th className="p-4 text-center text-sm font-medium">Status</th>
                    <th className="p-4 text-right text-sm font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {transactionsLoading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b">
                        <td className="p-4"><Skeleton className="h-4 w-4" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-48" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-16" /></td>
                        <td className="p-4"><Skeleton className="h-4 w-16" /></td>
                      </tr>
                    ))
                  ) : sortedTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">
                        No transactions found
                      </td>
                    </tr>
                  ) : (
                    sortedTransactions.map((tx) => {
                      const allocation = tx.allocations?.[0];
                      const category = allocation ? categories.find(c => c.id === allocation.categoryId) : null;
                      const isAllocated = !!allocation;

                      return (
                        <tr key={tx.id} className="border-b hover-elevate">
                          <td className="p-4">
                            <Checkbox
                              checked={selectedTransactions.includes(tx.id)}
                              onCheckedChange={() => toggleSelect(tx.id)}
                              data-testid={`checkbox-transaction-${tx.id}`}
                            />
                          </td>
                          <td className="p-4 text-sm">{formatDate(tx.date instanceof Date ? tx.date.toISOString() : String(tx.date))}</td>
                          <td className="p-4">
                            <div className="font-medium text-sm">{tx.name}</div>
                            {tx.merchantName && (
                              <div className="text-xs text-muted-foreground">{tx.merchantName}</div>
                            )}
                          </td>
                          <td className="p-4">
                            {category ? (
                              <Badge variant="secondary">{category.name}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </td>
                          <td className={`p-4 text-right font-medium ${parseFloat(tx.amount) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(parseFloat(tx.amount))}
                          </td>
                          <td className="p-4 text-center">
                            {isAllocated ? (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                <CheckCircle className="w-3 h-3 mr-1" />
                                Allocated
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                                <XCircle className="w-3 h-3 mr-1" />
                                Pending
                              </Badge>
                            )}
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end gap-1">
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => openAllocateDialog(tx)}
                                data-testid={`button-allocate-${tx.id}`}
                              >
                                <Tags className="w-4 h-4" />
                              </Button>
                              <Button 
                                variant="ghost" 
                                size="sm"
                                onClick={() => openSplitDialog(tx)}
                                data-testid={`button-split-${tx.id}`}
                              >
                                <Split className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={allocateDialogOpen} onOpenChange={setAllocateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Allocate Transaction</DialogTitle>
              <DialogDescription>
                Assign this transaction to a category for reporting.
              </DialogDescription>
            </DialogHeader>
            {selectedTransaction && (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="font-medium">{selectedTransaction.name}</div>
                  <div className="text-sm text-muted-foreground">{formatDate(selectedTransaction.date instanceof Date ? selectedTransaction.date.toISOString() : String(selectedTransaction.date))}</div>
                  <div className={`font-bold mt-2 ${parseFloat(selectedTransaction.amount) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(parseFloat(selectedTransaction.amount))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Select value={allocateCategory} onValueChange={setAllocateCategory}>
                    <SelectTrigger data-testid="select-allocate-category">
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          <div className="flex items-center gap-2">
                            <Badge variant={cat.type === 'income' ? 'default' : 'secondary'} className="text-xs">
                              {cat.type}
                            </Badge>
                            {cat.name}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setAllocateDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAllocate} 
                disabled={!allocateCategory || allocateMutation.isPending}
                data-testid="button-confirm-allocate"
              >
                {allocateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Allocate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={splitDialogOpen} onOpenChange={setSplitDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Split Transaction</DialogTitle>
              <DialogDescription>
                Divide this transaction across multiple categories.
              </DialogDescription>
            </DialogHeader>
            {selectedTransaction && (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg">
                  <div className="font-medium">{selectedTransaction.name}</div>
                  <div className="text-sm text-muted-foreground">{formatDate(selectedTransaction.date instanceof Date ? selectedTransaction.date.toISOString() : String(selectedTransaction.date))}</div>
                  <div className={`font-bold mt-2 ${parseFloat(selectedTransaction.amount) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatCurrency(parseFloat(selectedTransaction.amount))}
                  </div>
                </div>
                
                <div className="space-y-3">
                  {splitAllocations.map((alloc, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <Select value={alloc.categoryId} onValueChange={(val) => updateSplitRow(index, 'categoryId', val)}>
                          <SelectTrigger>
                            <SelectValue placeholder="Category" />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="w-32">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Amount"
                          value={alloc.amount}
                          onChange={(e) => updateSplitRow(index, 'amount', e.target.value)}
                        />
                      </div>
                      {splitAllocations.length > 1 && (
                        <Button 
                          variant="ghost" 
                          size="icon"
                          onClick={() => removeSplitRow(index)}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                
                <Button variant="outline" size="sm" onClick={addSplitRow}>
                  Add Another Split
                </Button>

                {/* Show allocation balance helper */}
                {(() => {
                  const transactionAmount = Math.abs(parseFloat(selectedTransaction.amount));
                  const allocatedAmount = splitAllocations.reduce((sum, a) => {
                    const amount = parseFloat(a.amount) || 0;
                    return sum + Math.abs(amount);
                  }, 0);
                  const remaining = transactionAmount - allocatedAmount;
                  
                  return (
                    <div className={`p-3 rounded-lg text-sm ${Math.abs(remaining) < 0.01 ? 'bg-green-100 dark:bg-green-900/30' : remaining > 0 ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                      <div className="flex justify-between">
                        <span>Total transaction:</span>
                        <span className="font-medium">${transactionAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Allocated:</span>
                        <span className="font-medium">${allocatedAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between border-t mt-1 pt-1">
                        <span>Remaining:</span>
                        <span className={`font-bold ${Math.abs(remaining) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>
                          ${remaining.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setSplitDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleSplit} 
                disabled={splitMutation.isPending || splitAllocations.every(a => !a.categoryId || !a.amount)}
                data-testid="button-confirm-split"
              >
                {splitMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Split Transaction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Add Transaction Dialog */}
        <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) resetAddForm(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Transaction</DialogTitle>
              <DialogDescription>
                Manually add a transaction to your records.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-full justify-start text-left font-normal", !newTxDate && "text-muted-foreground")}
                      data-testid="button-new-tx-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {newTxDate ? format(newTxDate, "MMM d, yyyy") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={newTxDate} onSelect={setNewTxDate} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Description *</Label>
                <Input
                  placeholder="e.g., Office supplies, Payroll, etc."
                  value={newTxDescription}
                  onChange={(e) => setNewTxDescription(e.target.value)}
                  data-testid="input-new-tx-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type *</Label>
                  <Select value={newTxType} onValueChange={(val) => setNewTxType(val as "income" | "expense")}>
                    <SelectTrigger data-testid="select-new-tx-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">Expense</SelectItem>
                      <SelectItem value="income">Income</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Amount *</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={newTxAmount}
                      onChange={(e) => setNewTxAmount(e.target.value)}
                      className="pl-7"
                      data-testid="input-new-tx-amount"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Category (optional)</Label>
                <Select value={newTxCategory} onValueChange={setNewTxCategory}>
                  <SelectTrigger data-testid="select-new-tx-category">
                    <SelectValue placeholder="Assign to category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No category</SelectItem>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <div className="flex items-center gap-2">
                          <Badge variant={cat.type === 'income' ? 'default' : 'secondary'} className="text-xs">
                            {cat.type}
                          </Badge>
                          {cat.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleAddTransaction} 
                disabled={createTransactionMutation.isPending || !newTxDate || !newTxDescription || !newTxAmount}
                data-testid="button-confirm-add-transaction"
              >
                {createTransactionMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Transaction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
