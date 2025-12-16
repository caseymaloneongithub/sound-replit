import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format, startOfDay, startOfWeek, endOfWeek, addWeeks, subWeeks, isWithinInterval, getDay, getDate, getMonth } from "date-fns";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  CalendarIcon, 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  ClipboardCheck, 
  Loader2,
  Pencil,
  Trash2,
  Check,
  User
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { AdminTask, AdminTaskCompletion, User as UserType } from "@shared/schema";

const taskFormSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  category: z.string().optional(),
  recurrence: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly", "one-time"]),
  dayOfWeek: z.number().min(0).max(6).optional().nullable(),
  dayOfMonth: z.number().min(1).max(31).optional().nullable(),
  monthOfYear: z.number().min(1).max(12).optional().nullable(),
  displayOrder: z.number().default(0),
}).refine((data) => {
  // Validate required fields based on recurrence type
  if (data.recurrence === "weekly" && (data.dayOfWeek === null || data.dayOfWeek === undefined)) {
    return false;
  }
  if ((data.recurrence === "monthly" || data.recurrence === "quarterly") && !data.dayOfMonth) {
    return false;
  }
  if (data.recurrence === "yearly" && (!data.dayOfMonth || !data.monthOfYear)) {
    return false;
  }
  if (data.recurrence === "one-time" && (!data.dayOfMonth || !data.monthOfYear)) {
    return false;
  }
  return true;
}, {
  message: "Please fill in all required schedule fields for the selected recurrence type",
  path: ["recurrence"],
});

type TaskFormValues = z.infer<typeof taskFormSchema>;

interface TaskWithCompletion extends AdminTask {
  completion?: AdminTaskCompletion & { completedByUser?: UserType };
}

const CATEGORIES = [
  { value: "operations", label: "Operations" },
  { value: "finance", label: "Finance" },
  { value: "maintenance", label: "Maintenance" },
  { value: "compliance", label: "Compliance" },
  { value: "inventory", label: "Inventory" },
  { value: "other", label: "Other" },
];

const RECURRENCE_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
  { value: "one-time", label: "One-time" },
];

const DAYS_OF_WEEK = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function getRecurrenceBadgeColor(recurrence: string): string {
  switch (recurrence) {
    case "daily": return "bg-blue-500";
    case "weekly": return "bg-green-500";
    case "monthly": return "bg-purple-500";
    case "quarterly": return "bg-orange-500";
    case "yearly": return "bg-red-500";
    case "one-time": return "bg-gray-500";
    default: return "bg-gray-500";
  }
}

function getCategoryBadgeVariant(category: string | null): "default" | "secondary" | "outline" {
  if (!category) return "outline";
  return "secondary";
}

function isTaskDueOnDate(task: AdminTask, date: Date): boolean {
  const dayOfWeek = getDay(date);
  const dayOfMonth = getDate(date);
  const month = getMonth(date) + 1; // getMonth returns 0-11

  switch (task.recurrence) {
    case "daily":
      return true;
    case "weekly":
      return task.dayOfWeek === dayOfWeek;
    case "monthly":
      return task.dayOfMonth === dayOfMonth;
    case "quarterly":
      // Quarters: Jan (1), Apr (4), Jul (7), Oct (10)
      const quarterMonths = [1, 4, 7, 10];
      return quarterMonths.includes(month) && task.dayOfMonth === dayOfMonth;
    case "yearly":
      return task.monthOfYear === month && task.dayOfMonth === dayOfMonth;
    case "one-time":
      // One-time tasks show on the specific date stored in dayOfMonth/monthOfYear or on creation date
      if (task.dayOfMonth && task.monthOfYear) {
        // Use current year since one-time doesn't specify year
        const taskDate = new Date(date.getFullYear(), task.monthOfYear - 1, task.dayOfMonth);
        return startOfDay(taskDate).getTime() === startOfDay(date).getTime();
      }
      // Fallback: show on creation date
      if (task.createdAt) {
        return startOfDay(new Date(task.createdAt)).getTime() === startOfDay(date).getTime();
      }
      return false;
    default:
      return false;
  }
}

function TaskForm({ 
  task, 
  onSubmit, 
  isLoading,
  onCancel 
}: { 
  task?: AdminTask;
  onSubmit: (values: TaskFormValues) => void;
  isLoading: boolean;
  onCancel: () => void;
}) {
  const form = useForm<TaskFormValues>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title || "",
      description: task?.description || "",
      category: task?.category || "",
      recurrence: (task?.recurrence as TaskFormValues["recurrence"]) || "weekly",
      dayOfWeek: task?.dayOfWeek ?? null,
      dayOfMonth: task?.dayOfMonth ?? null,
      monthOfYear: task?.monthOfYear ?? null,
      displayOrder: task?.displayOrder || 0,
    },
  });

  const recurrence = form.watch("recurrence");

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input placeholder="Task title" {...field} data-testid="input-task-title" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Optional description" 
                  {...field} 
                  value={field.value || ""}
                  data-testid="input-task-description"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value || ""}>
                  <FormControl>
                    <SelectTrigger data-testid="select-task-category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="recurrence"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Recurrence</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-testid="select-task-recurrence">
                      <SelectValue placeholder="Select recurrence" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {recurrence === "weekly" && (
          <FormField
            control={form.control}
            name="dayOfWeek"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Day of Week</FormLabel>
                <Select 
                  onValueChange={(val) => field.onChange(parseInt(val))} 
                  value={field.value?.toString() || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-day-of-week">
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DAYS_OF_WEEK.map((day) => (
                      <SelectItem key={day.value} value={day.value.toString()}>
                        {day.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {(recurrence === "monthly" || recurrence === "quarterly" || recurrence === "yearly" || recurrence === "one-time") && (
          <FormField
            control={form.control}
            name="dayOfMonth"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Day of Month</FormLabel>
                <Select 
                  onValueChange={(val) => field.onChange(parseInt(val))} 
                  value={field.value?.toString() || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-day-of-month">
                      <SelectValue placeholder="Select day" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <SelectItem key={day} value={day.toString()}>
                        {day}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {(recurrence === "yearly" || recurrence === "one-time") && (
          <FormField
            control={form.control}
            name="monthOfYear"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Month</FormLabel>
                <Select 
                  onValueChange={(val) => field.onChange(parseInt(val))} 
                  value={field.value?.toString() || ""}
                >
                  <FormControl>
                    <SelectTrigger data-testid="select-month-of-year">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {[
                      "January", "February", "March", "April", "May", "June",
                      "July", "August", "September", "October", "November", "December"
                    ].map((month, idx) => (
                      <SelectItem key={idx + 1} value={(idx + 1).toString()}>
                        {month}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="displayOrder"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Order</FormLabel>
              <FormControl>
                <Input 
                  type="number" 
                  placeholder="0" 
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  data-testid="input-display-order"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-task">
            Cancel
          </Button>
          <Button type="submit" disabled={isLoading} data-testid="button-save-task">
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {task ? "Update Task" : "Create Task"}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

export default function AdminChecklist() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(startOfDay(new Date()));
  const [activeTab, setActiveTab] = useState("checklist");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AdminTask | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const dateString = format(selectedDate, "yyyy-MM-dd");

  // Fetch all tasks
  const { data: tasks = [], isLoading: tasksLoading } = useQuery<AdminTask[]>({
    queryKey: ["/api/admin-tasks"],
  });

  // Fetch completions for selected date
  const { data: completions = [], isLoading: completionsLoading } = useQuery<(AdminTaskCompletion & { completedByUser?: UserType })[]>({
    queryKey: ["/api/admin-tasks/completions/by-date", dateString],
    queryFn: async () => {
      const res = await fetch(`/api/admin-tasks/completions/by-date?date=${dateString}`);
      if (!res.ok) throw new Error("Failed to fetch completions");
      return res.json();
    },
  });

  // Tasks due on selected date with completion status
  const tasksForDate: TaskWithCompletion[] = tasks
    .filter((task) => task.isActive && isTaskDueOnDate(task, selectedDate))
    .map((task) => ({
      ...task,
      completion: completions.find((c) => c.taskId === task.id),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  const completedCount = tasksForDate.filter((t) => t.completion).length;
  const totalCount = tasksForDate.length;

  // Mutations
  const createTaskMutation = useMutation({
    mutationFn: async (values: TaskFormValues) => {
      return await apiRequest("POST", "/api/admin-tasks", values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-tasks"] });
      setCreateDialogOpen(false);
      toast({ title: "Task created", description: "New task has been added to the checklist" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create task", variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: TaskFormValues }) => {
      return await apiRequest("PATCH", `/api/admin-tasks/${id}`, values);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-tasks"] });
      setEditingTask(null);
      toast({ title: "Task updated", description: "Task has been updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update task", variant: "destructive" });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/admin-tasks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-tasks"] });
      setDeletingTaskId(null);
      toast({ title: "Task deleted", description: "Task has been removed from the checklist" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete task", variant: "destructive" });
    },
  });

  const completeTaskMutation = useMutation({
    mutationFn: async ({ taskId, notes }: { taskId: string; notes?: string }) => {
      return await apiRequest("POST", `/api/admin-tasks/${taskId}/complete`, { 
        instanceDate: selectedDate.toISOString(),
        notes 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-tasks/completions/by-date", dateString] });
      toast({ title: "Task completed", description: "Task has been marked as complete" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to complete task", variant: "destructive" });
    },
  });

  const uncompleteTaskMutation = useMutation({
    mutationFn: async (completionId: string) => {
      return await apiRequest("DELETE", `/api/admin-tasks/completions/${completionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin-tasks/completions/by-date", dateString] });
      toast({ title: "Task uncompleted", description: "Task completion has been undone" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to undo completion", variant: "destructive" });
    },
  });

  const handleToggleTask = (task: TaskWithCompletion) => {
    if (task.completion) {
      uncompleteTaskMutation.mutate(task.completion.id);
    } else {
      completeTaskMutation.mutate({ taskId: task.id });
    }
  };

  const goToPreviousWeek = () => setSelectedDate((d) => subWeeks(d, 1));
  const goToNextWeek = () => setSelectedDate((d) => addWeeks(d, 1));
  const goToThisWeek = () => setSelectedDate(startOfDay(new Date()));

  // Get the week range for the selected date
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 }); // Sunday
  const weekEnd = endOfWeek(selectedDate, { weekStartsOn: 0 }); // Saturday
  const isCurrentWeek = isWithinInterval(new Date(), { start: weekStart, end: weekEnd });

  const isLoading = tasksLoading || completionsLoading;

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6" />
              Weekly Checklist
            </h1>
            <p className="text-muted-foreground">Track and complete weekly operational tasks</p>
          </div>

          {isAdmin && (
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-task">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Task
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create New Task</DialogTitle>
                  <DialogDescription>Add a new task to the checklist</DialogDescription>
                </DialogHeader>
                <TaskForm
                  onSubmit={(values) => createTaskMutation.mutate(values)}
                  isLoading={createTaskMutation.isPending}
                  onCancel={() => setCreateDialogOpen(false)}
                />
              </DialogContent>
            </Dialog>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="checklist" data-testid="tab-checklist">Checklist</TabsTrigger>
            {isAdmin && <TabsTrigger value="manage" data-testid="tab-manage">Manage Tasks</TabsTrigger>}
          </TabsList>

          <TabsContent value="checklist" className="space-y-4">
            {/* Date Navigation */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={goToPreviousWeek} data-testid="button-prev-week">
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="min-w-[280px]" data-testid="button-date-picker">
                          <CalendarIcon className="w-4 h-4 mr-2" />
                          {format(weekStart, "MMM d")} - {format(weekEnd, "MMM d, yyyy")}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={selectedDate}
                          onSelect={(date) => date && setSelectedDate(startOfDay(date))}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>

                    <Button variant="outline" size="icon" onClick={goToNextWeek} data-testid="button-next-week">
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="flex items-center gap-3">
                    {!isCurrentWeek && (
                      <Button variant="ghost" onClick={goToThisWeek} data-testid="button-go-this-week">
                        This Week
                      </Button>
                    )}
                    <Badge variant={completedCount === totalCount && totalCount > 0 ? "default" : "secondary"} data-testid="badge-progress">
                      {completedCount} / {totalCount} completed
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Task List */}
            {isLoading ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
                  <p className="mt-2 text-muted-foreground">Loading tasks...</p>
                </CardContent>
              </Card>
            ) : tasksForDate.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ClipboardCheck className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No tasks scheduled for this date</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {tasksForDate.map((task) => (
                  <Card 
                    key={task.id} 
                    className={task.completion ? "bg-muted/50" : ""}
                    data-testid={`task-card-${task.id}`}
                  >
                    <CardContent className="py-4">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          checked={!!task.completion}
                          onCheckedChange={() => handleToggleTask(task)}
                          disabled={completeTaskMutation.isPending || uncompleteTaskMutation.isPending}
                          data-testid={`checkbox-task-${task.id}`}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`font-medium ${task.completion ? "line-through text-muted-foreground" : ""}`}>
                              {task.title}
                            </span>
                            <Badge 
                              variant={getCategoryBadgeVariant(task.category)}
                              className="text-xs"
                            >
                              {task.category || "Uncategorized"}
                            </Badge>
                            <Badge 
                              className={`text-xs text-white ${getRecurrenceBadgeColor(task.recurrence)}`}
                            >
                              {task.recurrence}
                            </Badge>
                          </div>
                          {task.description && (
                            <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
                          )}
                          {task.completion && (
                            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                              <Check className="w-3 h-3" />
                              <span>
                                Completed by {task.completion.completedByUser?.firstName || "Unknown"}{" "}
                                {task.completion.completedByUser?.lastName || ""} at{" "}
                                {format(new Date(task.completion.completedAt), "h:mm a")}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {isAdmin && (
            <TabsContent value="manage" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>All Tasks</CardTitle>
                  <CardDescription>Manage recurring checklist tasks</CardDescription>
                </CardHeader>
                <CardContent>
                  {tasksLoading ? (
                    <div className="py-8 text-center">
                      <Loader2 className="w-8 h-8 mx-auto animate-spin text-muted-foreground" />
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="py-8 text-center text-muted-foreground">
                      No tasks created yet. Click "Add Task" to create one.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {tasks
                        .sort((a, b) => a.displayOrder - b.displayOrder)
                        .map((task) => (
                          <div 
                            key={task.id} 
                            className="flex items-center justify-between p-3 border rounded-lg"
                            data-testid={`manage-task-${task.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`font-medium ${!task.isActive ? "text-muted-foreground line-through" : ""}`}>
                                  {task.title}
                                </span>
                                {!task.isActive && (
                                  <Badge variant="outline" className="text-xs">Inactive</Badge>
                                )}
                                <Badge 
                                  variant={getCategoryBadgeVariant(task.category)}
                                  className="text-xs"
                                >
                                  {task.category || "Uncategorized"}
                                </Badge>
                                <Badge 
                                  className={`text-xs text-white ${getRecurrenceBadgeColor(task.recurrence)}`}
                                >
                                  {task.recurrence}
                                </Badge>
                              </div>
                              {task.description && (
                                <p className="text-sm text-muted-foreground mt-1 truncate">{task.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              <Dialog open={editingTask?.id === task.id} onOpenChange={(open) => !open && setEditingTask(null)}>
                                <DialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => setEditingTask(task)}
                                    data-testid={`button-edit-task-${task.id}`}
                                  >
                                    <Pencil className="w-4 h-4" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-lg">
                                  <DialogHeader>
                                    <DialogTitle>Edit Task</DialogTitle>
                                    <DialogDescription>Update task details</DialogDescription>
                                  </DialogHeader>
                                  {editingTask && (
                                    <TaskForm
                                      task={editingTask}
                                      onSubmit={(values) => updateTaskMutation.mutate({ id: editingTask.id, values })}
                                      isLoading={updateTaskMutation.isPending}
                                      onCancel={() => setEditingTask(null)}
                                    />
                                  )}
                                </DialogContent>
                              </Dialog>

                              <Dialog open={deletingTaskId === task.id} onOpenChange={(open) => !open && setDeletingTaskId(null)}>
                                <DialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    onClick={() => setDeletingTaskId(task.id)}
                                    data-testid={`button-delete-task-${task.id}`}
                                  >
                                    <Trash2 className="w-4 h-4 text-destructive" />
                                  </Button>
                                </DialogTrigger>
                                <DialogContent>
                                  <DialogHeader>
                                    <DialogTitle>Delete Task</DialogTitle>
                                    <DialogDescription>
                                      Are you sure you want to delete "{task.title}"? This will also delete all completion records.
                                    </DialogDescription>
                                  </DialogHeader>
                                  <DialogFooter className="gap-2">
                                    <Button variant="outline" onClick={() => setDeletingTaskId(null)}>
                                      Cancel
                                    </Button>
                                    <Button 
                                      variant="destructive"
                                      onClick={() => deleteTaskMutation.mutate(task.id)}
                                      disabled={deleteTaskMutation.isPending}
                                      data-testid="button-confirm-delete"
                                    >
                                      {deleteTaskMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                                      Delete
                                    </Button>
                                  </DialogFooter>
                                </DialogContent>
                              </Dialog>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </div>
    </StaffLayout>
  );
}
