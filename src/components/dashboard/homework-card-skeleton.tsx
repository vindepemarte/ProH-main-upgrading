"use client"
import React from 'react';
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const HomeworkCardSkeleton = React.memo(function HomeworkCardSkeleton() {
    return (
        <Card className="border-l-4 border-l-gray-200">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-5 w-20" />
                </div>
                <Skeleton className="h-4 w-24 mt-2" />
            </CardHeader>
            <CardContent className="pb-2">
                <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-4 w-3/4" />
                </div>
            </CardContent>
            <CardFooter className="pt-2">
                <Skeleton className="h-8 w-full" />
            </CardFooter>
        </Card>
    );
});

export default HomeworkCardSkeleton;