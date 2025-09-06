
"use client"
import { useAppContext } from "@/contexts/app-context";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { HomeworkStatus } from "@/lib/types";
import { useState, useMemo, useCallback, useEffect } from "react";
import { Search, Filter, Loader2 } from "lucide-react";
import PaymentInfo from "./payment-info";
import PriceIncreaseRequests from './price-increase-requests';
import { useHomeworksPaginated } from '@/hooks/use-homeworks';
import { useInView } from 'react-intersection-observer';
import { useHomeworkWebSocket } from '@/hooks/use-websocket';
import HomeworkCard from './homework-card';
import HomeworkCardSkeleton from './homework-card-skeleton';

const statusColors: Record<HomeworkStatus, string> = {
  payment_approval: "bg-yellow-500/20 text-yellow-700 border-yellow-500/30",
  in_progress: "bg-blue-500/20 text-blue-700 border-blue-500/30",
  requested_changes: "bg-orange-500/20 text-orange-700 border-orange-500/30",
  final_payment_approval: "bg-green-500/20 text-green-700 border-green-500/30",
  word_count_change: "bg-purple-500/20 text-purple-700 border-purple-500/30",
  deadline_change: "bg-indigo-500/20 text-indigo-700 border-indigo-500/30",
  declined: "bg-red-500/20 text-red-700 border-red-500/30",
  refund: "bg-gray-500/20 text-gray-700 border-gray-500/30",
  completed: "bg-teal-500/20 text-teal-700 border-teal-500/30",
  assigned_to_super_worker: "bg-cyan-500/20 text-cyan-700 border-cyan-500/30",
  assigned_to_worker: "bg-violet-500/20 text-violet-700 border-violet-500/30",
  worker_draft: "bg-amber-500/20 text-amber-700 border-amber-500/30",
};

export default function HomeworkList() {
    const { user, setSelectedHomework, setIsHomeworkModalOpen } = useAppContext();
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [orderSearch, setOrderSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    
    // WebSocket connection for real-time updates
    const { isConnected: wsConnected, error: wsError } = useHomeworkWebSocket();
    
    // Debounce search input to reduce API calls
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(orderSearch);
        }, 300);
        return () => clearTimeout(timer);
    }, [orderSearch]);

    // Use React Query for homework data with pagination
    const {
        data,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        isLoading,
        isError,
        error
    } = useHomeworksPaginated({
        user: user!,
        limit: 20,
        enabled: !!user
    });

    // Intersection observer for infinite scroll
    const { ref: loadMoreRef, inView } = useInView({
        threshold: 0,
        rootMargin: '100px'
    });

    // Load more when scrolled to bottom
    useEffect(() => {
        if (inView && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

    // Safe status filter change handler
    const handleStatusFilterChange = useCallback((value: string) => {
        setStatusFilter(value);
    }, []);

    // Flatten paginated data
    const allHomeworks = useMemo(() => {
        if (!data?.pages) return [];
        return data.pages.flatMap(page => page.homeworks);
    }, [data]);

    // Filter homeworks based on user role and filters with defensive checks
    const filteredHomeworks = useMemo(() => {
        if (!allHomeworks || !Array.isArray(allHomeworks) || allHomeworks.length === 0) return [];
        
        try {
            let filtered = allHomeworks.filter(hw => hw && typeof hw === 'object' && hw.status);

            // Filter by status
            if (statusFilter && statusFilter !== "all") {
                filtered = filtered.filter(hw => hw && hw.status === statusFilter);
            }

            // Filter by order number search (for staff roles)
            if (debouncedSearch && debouncedSearch.trim() && user && user.role && ['agent', 'super_agent', 'super_worker'].includes(user.role)) {
                filtered = filtered.filter(hw => 
                    hw && hw.id && typeof hw.id === 'string' && hw.id.toLowerCase().includes(debouncedSearch.toLowerCase())
                );
            }

            return Array.isArray(filtered) ? filtered : [];
        } catch (error) {
            console.error('Error filtering homeworks:', error);
            return [];
        }
    }, [allHomeworks, statusFilter, debouncedSearch, user]);

    // Get available statuses for filter dropdown with role-specific filtering
    const availableStatuses = useMemo(() => {
        if (!allHomeworks || !Array.isArray(allHomeworks) || allHomeworks.length === 0 || !user) return [];
        try {
            const validHomeworks = allHomeworks.filter(hw => hw && typeof hw === 'object' && hw.status);
            if (validHomeworks.length === 0) return [];
            
            let statuses = [...new Set(validHomeworks.map(hw => hw.status).filter(status => status && typeof status === 'string'))];
            
            // Filter statuses based on user role for better UX
            if (user.role === 'super_worker') {
                // Super workers primarily see assignments and drafts
                statuses = statuses.filter(status => 
                    ['assigned_to_super_worker', 'assigned_to_worker', 'worker_draft', 'final_payment_approval', 'completed'].includes(status)
                );
            } else if (user.role === 'worker') {
                // Workers see their assignments and drafts
                statuses = statuses.filter(status => 
                    ['assigned_to_worker', 'worker_draft', 'final_payment_approval', 'completed'].includes(status)
                );
            }
            
            return Array.isArray(statuses) ? statuses.sort() : [];
        } catch (error) {
            console.error('Error processing available statuses:', error);
            return [];
        }
    }, [allHomeworks, user]);

    if (!user) return null;
    
    // Loading state with skeletons
    if (isLoading) {
        return (
            <div className="space-y-6">
                {user?.role === 'super_agent' && (
                    <div className="grid gap-4 md:grid-cols-2">
                        <PaymentInfo />
                        <PriceIncreaseRequests />
                    </div>
                )}
                
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <h2 className="text-2xl font-bold tracking-tight">Homework Assignments</h2>
                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search by order ID..."
                                value={orderSearch}
                                onChange={(e) => setOrderSearch(e.target.value)}
                                className="pl-8 w-[200px]"
                                disabled
                            />
                        </div>
                        <Select value={statusFilter} onValueChange={handleStatusFilterChange} disabled>
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Filter by status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Statuses</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                
                <ScrollArea className="h-[calc(100vh-280px)]">
                    <div className="grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <HomeworkCardSkeleton key={index} />
                        ))}
                    </div>
                </ScrollArea>
            </div>
        );
    }

    // Error state
    if (isError) {
        return (
            <div className="flex items-center justify-center h-64">
                <p className="text-red-600">Error loading homeworks: {error?.message || 'Unknown error'}</p>
            </div>
        );
    }

    const isStaffRole = ['agent', 'super_agent', 'super_worker'].includes(user.role);

    const openHomeworkModal = (homeworkId: string) => {
        if (!allHomeworks || !Array.isArray(allHomeworks) || !homeworkId) return;
        try {
            const homework = allHomeworks.find(h => h && h.id === homeworkId);
            if (homework && typeof homework === 'object') {
                setSelectedHomework(homework);
                setIsHomeworkModalOpen(true);
            }
        } catch (error) {
            console.error('Error opening homework modal:', error);
        }
    }

    return (
        <div className="space-y-4">
            {/* Payment Information for Students */}
            <PaymentInfo />
            
            {/* Price Increase Requests Section */}
            <PriceIncreaseRequests />
            
            {/* Filter Controls */}
            <div className="flex flex-col sm:flex-row gap-4 p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Filter className="h-4 w-4 text-muted-foreground" />
                    <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
                        <SelectTrigger className="w-full sm:w-[200px]">
                            <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            {Array.isArray(availableStatuses) && availableStatuses.length > 0 && availableStatuses.map(status => (
                                <SelectItem key={status} value={status}>
                                    {status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                
                {/* Order number search for staff roles */}
                {isStaffRole && (
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by order number..."
                            value={orderSearch}
                            onChange={(e) => setOrderSearch(e.target.value)}
                            className="w-full sm:w-[200px]"
                        />
                    </div>
                )}
                
                <div className="flex items-center gap-2 text-sm text-muted-foreground self-center">
                    <span>
                        {filteredHomeworks.length} of {allHomeworks?.length || 0} homework{(allHomeworks?.length || 0) !== 1 ? 's' : ''}
                        {hasNextPage && <span className="ml-1">(+ more)</span>}
                    </span>
                    {/* Real-time connection indicator */}
                    <div className={`w-2 h-2 rounded-full ${
                        wsConnected ? 'bg-green-500' : wsError ? 'bg-red-500' : 'bg-yellow-500'
                    }`} title={wsConnected ? 'Real-time updates active' : wsError ? 'Connection error' : 'Connecting...'} />
                </div>
            </div>

            {/* Homework Grid */}
            <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="grid gap-4 p-2 sm:p-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {Array.isArray(filteredHomeworks) && filteredHomeworks.length > 0 ? filteredHomeworks.map(homework => (
                        <HomeworkCard
                            key={homework.id}
                            homework={homework}
                            onOpenModal={openHomeworkModal}
                            userRole={user?.role}
                        />
                    )) : (
                        <div className="col-span-full text-center text-muted-foreground py-10">
                            <p>
                                {statusFilter !== "all" || orderSearch.trim() 
                                    ? "No homework assignments match your filters." 
                                    : "No homework assignments found."
                                }
                            </p>
                            {(statusFilter !== "all" || orderSearch.trim()) && (
                                <Button 
                                    variant="link" 
                                    onClick={() => { setStatusFilter("all"); setOrderSearch(""); }}
                                    className="mt-2"
                                >
                                    Clear filters
                                </Button>
                            )}
                        </div>
                    )}
                    
                    {/* Load more trigger */}
                    {hasNextPage && (
                        <div ref={loadMoreRef} className="col-span-full flex justify-center py-4">
                            {isFetchingNextPage ? (
                                <div className="flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span className="text-sm text-muted-foreground">Loading more...</span>
                                </div>
                            ) : (
                                <Button 
                                    variant="outline" 
                                    onClick={() => fetchNextPage()}
                                    className="w-full max-w-xs"
                                >
                                    Load More
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}
