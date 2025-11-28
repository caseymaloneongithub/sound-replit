import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StaffLayout } from "@/components/staff/staff-layout";
import { 
  Landmark,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle,
  AlertCircle,
  XCircle,
  Loader2,
  CreditCard,
  Building,
  Calendar
} from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { PlaidItem, PlaidAccount } from "@shared/schema";

interface PlaidItemWithAccounts extends PlaidItem {
  accounts?: PlaidAccount[];
}

function formatDate(dateValue: Date | string | null): string {
  if (!dateValue) return 'Never';
  const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
  return format(date, 'MMM d, yyyy h:mm a');
}

interface PlaidStatusResponse {
  configured: boolean;
  environment: string;
}

export default function AccountingBanks() {
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PlaidItem | null>(null);
  const [plaidReady, setPlaidReady] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);

  const { data: plaidStatus } = useQuery<PlaidStatusResponse>({
    queryKey: ['/api/accounting/plaid/status'],
  });

  const { data: plaidItems = [], isLoading: itemsLoading } = useQuery<PlaidItemWithAccounts[]>({
    queryKey: ['/api/accounting/plaid/items'],
    enabled: plaidStatus?.configured ?? false,
  });

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<PlaidAccount[]>({
    queryKey: ['/api/accounting/plaid/accounts'],
    enabled: plaidStatus?.configured ?? false,
  });

  const linkTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/accounting/plaid/link-token');
      return response as { link_token: string };
    },
    onSuccess: (data) => {
      setLinkToken(data.link_token);
      openPlaidLink(data.link_token);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to initialize bank connection", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const exchangeTokenMutation = useMutation({
    mutationFn: async (publicToken: string) => {
      return apiRequest('POST', '/api/accounting/plaid/exchange-token', { public_token: publicToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/accounts'] });
      toast({ title: "Bank account connected successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to connect bank account", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const syncAccountsMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest('POST', `/api/accounting/plaid/items/${itemId}/sync-accounts`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/accounts'] });
      toast({ title: "Accounts synced successfully" });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to sync accounts", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const syncTransactionsMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest('POST', `/api/accounting/plaid/items/${itemId}/sync-transactions`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/transactions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/items'] });
      toast({ 
        title: "Transactions synced", 
        description: `Added ${data.added} new, modified ${data.modified}, removed ${data.removed}` 
      });
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to sync transactions", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      return apiRequest('DELETE', `/api/accounting/plaid/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/items'] });
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/plaid/accounts'] });
      toast({ title: "Bank connection removed" });
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast({ 
        title: "Failed to remove connection", 
        description: error.message, 
        variant: "destructive" 
      });
    }
  });

  const openPlaidLink = useCallback((token: string) => {
    if (typeof window !== 'undefined' && (window as any).Plaid) {
      const plaid = (window as any).Plaid;
      
      const handler = plaid.create({
        token,
        onSuccess: (publicToken: string, metadata: any) => {
          exchangeTokenMutation.mutate(publicToken);
        },
        onExit: (err: any, metadata: any) => {
          if (err) {
            toast({ 
              title: "Connection cancelled", 
              description: err.display_message || "Bank connection was not completed",
              variant: "destructive"
            });
          }
        },
        onEvent: (eventName: string, metadata: any) => {
          console.log('[Plaid Event]', eventName, metadata);
        },
      });
      
      handler.open();
    } else {
      toast({ 
        title: "Plaid not available", 
        description: "Please refresh the page and try again",
        variant: "destructive"
      });
    }
  }, [exchangeTokenMutation, toast]);

  const handleConnectBank = () => {
    linkTokenMutation.mutate();
  };

  const openDeleteDialog = (item: PlaidItem) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleDelete = () => {
    if (selectedItem) {
      deleteItemMutation.mutate(selectedItem.id);
    }
  };

  const getItemAccounts = (itemId: string) => {
    return accounts.filter(a => a.plaidItemId === itemId);
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'good':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
            <CheckCircle className="w-3 h-3 mr-1" />
            Connected
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
            <XCircle className="w-3 h-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-200">
            <AlertCircle className="w-3 h-3 mr-1" />
            Pending
          </Badge>
        );
    }
  };

  const getAccountTypeIcon = (type: string | null) => {
    switch (type?.toLowerCase()) {
      case 'credit':
        return <CreditCard className="w-4 h-4" />;
      case 'depository':
        return <Building className="w-4 h-4" />;
      default:
        return <Landmark className="w-4 h-4" />;
    }
  };

  const isLoading = itemsLoading || accountsLoading;

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="heading-bank-connections">
              Bank Connections
            </h1>
            <p className="text-muted-foreground">
              Connect bank accounts to automatically import transactions
            </p>
          </div>
          <Button 
            onClick={handleConnectBank}
            disabled={linkTokenMutation.isPending || !plaidStatus?.configured}
            data-testid="button-connect-bank"
          >
            {linkTokenMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Plus className="w-4 h-4 mr-2" />
            )}
            Connect Bank
          </Button>
        </div>

        {plaidStatus?.configured === false && (
          <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
            <CardContent className="py-4">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-amber-100 rounded-lg dark:bg-amber-900">
                  <AlertCircle className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-medium text-amber-800 dark:text-amber-200">Plaid Not Configured</h3>
                  <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                    Bank integration requires Plaid API credentials. Please add PLAID_CLIENT_ID and 
                    PLAID_SECRET environment variables to enable automatic bank transaction imports.
                    You can still import transactions manually via CSV in the Transactions page.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {plaidStatus?.configured && (
          <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/20">
            <CardContent className="py-4">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-blue-100 rounded-lg dark:bg-blue-900">
                  <Landmark className="w-5 h-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-medium">Secure Bank Integration</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    We use Plaid to securely connect to your bank. Your credentials are never stored 
                    on our servers. Transactions are automatically imported and can be categorized for 
                    accurate financial reporting.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-4 w-32 mt-2" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : !plaidStatus?.configured ? (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-amber-500" />
              <h3 className="text-lg font-medium mb-2">Bank Integration Not Available</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Plaid API credentials need to be configured to enable bank account connections.
                In the meantime, you can import transactions manually using CSV files.
              </p>
            </CardContent>
          </Card>
        ) : plaidItems.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Landmark className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">No Bank Accounts Connected</h3>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                Connect your business bank accounts to automatically import transactions 
                and streamline your bookkeeping.
              </p>
              <Button 
                onClick={handleConnectBank}
                disabled={linkTokenMutation.isPending || !plaidStatus?.configured}
              >
                {linkTokenMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4 mr-2" />
                )}
                Connect Your First Bank
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {plaidItems.map((item) => {
              const itemAccounts = getItemAccounts(item.id);
              
              return (
                <Card key={item.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-muted rounded-lg">
                          <Building className="w-5 h-5" />
                        </div>
                        <div>
                          <CardTitle className="text-lg">{item.institutionName}</CardTitle>
                          <CardDescription className="flex items-center gap-2 mt-1">
                            <Calendar className="w-3 h-3" />
                            Last synced: {formatDate(item.lastSynced)}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(item.status)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {itemAccounts.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2">
                          {itemAccounts.map((account) => (
                            <div 
                              key={account.id}
                              className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                            >
                              {getAccountTypeIcon(account.accountType)}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                  {account.officialName || account.name}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {account.accountType} •••• {account.mask}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          No accounts found. Try syncing to fetch account data.
                        </p>
                      )}

                      <div className="flex gap-2 pt-2 border-t">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => syncAccountsMutation.mutate(item.id)}
                          disabled={syncAccountsMutation.isPending}
                          data-testid={`button-sync-accounts-${item.id}`}
                        >
                          {syncAccountsMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4 mr-2" />
                          )}
                          Sync Accounts
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => syncTransactionsMutation.mutate(item.id)}
                          disabled={syncTransactionsMutation.isPending}
                          data-testid={`button-sync-transactions-${item.id}`}
                        >
                          {syncTransactionsMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : (
                            <RefreshCw className="w-4 h-4 mr-2" />
                          )}
                          Sync Transactions
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          className="ml-auto text-destructive hover:text-destructive"
                          onClick={() => openDeleteDialog(item)}
                          data-testid={`button-remove-connection-${item.id}`}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Bank Connection</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove the connection to {selectedItem?.institutionName}? 
                This will stop importing new transactions from this bank. Existing transactions 
                will not be deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-remove"
              >
                {deleteItemMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Remove Connection
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </StaffLayout>
  );
}
