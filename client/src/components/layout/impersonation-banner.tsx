import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type UserWithImpersonation = ReturnType<typeof useAuth>['user'] & {
  impersonation?: {
    isImpersonating: boolean;
    originalUser: {
      id: string;
      username: string;
    };
  };
};

export function ImpersonationBanner() {
  const { user: rawUser } = useAuth();
  const user = rawUser as UserWithImpersonation;
  const { toast } = useToast();

  const stopImpersonationMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/impersonate/stop", {
        method: "POST",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to stop impersonation");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      window.location.href = "/staff-portal";
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to stop impersonation",
        variant: "destructive",
      });
    },
  });

  if (!user?.impersonation?.isImpersonating) {
    return null;
  }

  return (
    <div className="bg-yellow-500 text-black px-4 py-2 flex items-center justify-between" data-testid="banner-impersonation">
      <div className="flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" />
        <span className="font-medium">
          Viewing as {user.username} (Original admin: {user.impersonation.originalUser.username})
        </span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => stopImpersonationMutation.mutate()}
        disabled={stopImpersonationMutation.isPending}
        data-testid="button-exit-impersonation"
        className="bg-white text-black border-black hover:bg-black hover:text-white"
      >
        {stopImpersonationMutation.isPending ? "Exiting..." : "Exit Impersonation"}
      </Button>
    </div>
  );
}
