"use client"
import { lazy, Suspense } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2 } from "lucide-react";

// Lazy load the analytics component
const AnalyticsView = lazy(() => import('./analytics-view'));

// Analytics skeleton component
function AnalyticsSkeleton() {
    return (
        <div className="p-4 space-y-4">
            <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                <Skeleton className="h-8 w-32" />
                <div className="flex flex-wrap items-center justify-center gap-2">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-8 w-48" />
                </div>
            </div>
            
            {/* KPI Cards Skeleton */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-7 mb-6">
                {Array.from({ length: 4 }).map((_, index) => (
                    <Card key={index}>
                        <div className="p-6">
                            <div className="flex items-center justify-between space-y-0 pb-2">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-4 w-4" />
                            </div>
                            <Skeleton className="h-8 w-16 mb-1" />
                            <Skeleton className="h-3 w-24" />
                        </div>
                    </Card>
                ))}
            </div>
            
            {/* Charts Skeleton */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <div className="p-6">
                        <Skeleton className="h-6 w-32 mb-2" />
                        <Skeleton className="h-4 w-48 mb-4" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                </Card>
                <Card>
                    <div className="p-6">
                        <Skeleton className="h-6 w-32 mb-2" />
                        <Skeleton className="h-4 w-48 mb-4" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                </Card>
            </div>
            
            {/* Tables Skeleton */}
            <div className="grid gap-4 md:grid-cols-2">
                <Card>
                    <div className="p-6">
                        <Skeleton className="h-6 w-40 mb-4" />
                        <div className="space-y-2">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <div key={index} className="flex justify-between">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-4 w-16" />
                                    <Skeleton className="h-4 w-12" />
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
                <Card>
                    <div className="p-6">
                        <Skeleton className="h-6 w-40 mb-4" />
                        <div className="space-y-2">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <div key={index} className="flex justify-between">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-4 w-16" />
                                    <Skeleton className="h-4 w-12" />
                                </div>
                            ))}
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
}

// Loading fallback with spinner
function AnalyticsLoadingFallback() {
    return (
        <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="ml-2 text-muted-foreground">Loading analytics...</p>
        </div>
    );
}

export default function LazyAnalytics() {
    return (
        <Suspense fallback={<AnalyticsSkeleton />}>
            <AnalyticsView />
        </Suspense>
    );
}

export { AnalyticsSkeleton, AnalyticsLoadingFallback };