"use client"
import React, { memo } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Homework, HomeworkStatus } from "@/lib/types";

const statusColors: Record<HomeworkStatus, string> = {
    payment_approval: "bg-yellow-100 text-yellow-800 border-yellow-200",
    assigned_to_super_worker: "bg-indigo-100 text-indigo-800 border-indigo-200",
    assigned_to_worker: "bg-cyan-100 text-cyan-800 border-cyan-200",
    in_progress: "bg-blue-100 text-blue-800 border-blue-200",
    worker_draft: "bg-orange-100 text-orange-800 border-orange-200",
    requested_changes: "bg-purple-100 text-purple-800 border-purple-200",
    final_payment_approval: "bg-green-100 text-green-800 border-green-200",
    word_count_change: "bg-amber-100 text-amber-800 border-amber-200",
    deadline_change: "bg-teal-100 text-teal-800 border-teal-200",
    declined: "bg-red-100 text-red-800 border-red-200",
    refund: "bg-red-100 text-red-800 border-red-200",
    completed: "bg-gray-100 text-gray-800 border-gray-200",
};

interface HomeworkCardProps {
    homework: Homework;
    onOpenModal: (homeworkId: string) => void;
    userRole?: string;
}

const HomeworkCard = React.memo(function HomeworkCard({ homework, onOpenModal, userRole }: HomeworkCardProps) {
    if (!homework || typeof homework !== 'object' || !homework.id) {
        return null;
    }

    const handleCardClick = () => {
        onOpenModal(homework.id);
    };

    return (
        <Card 
            key={homework.id} 
            className="cursor-pointer hover:shadow-md transition-shadow duration-200 border-l-4" 
            style={{ borderLeftColor: homework.status ? statusColors[homework.status]?.split(' ')[0]?.replace('bg-', '#') || '#gray' : '#gray' }}
            onClick={handleCardClick}
        >
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                    <CardTitle className="text-lg font-semibold truncate pr-2">
                        {homework.moduleName || 'Untitled Assignment'}
                    </CardTitle>
                    <Badge 
                        variant="outline" 
                        className={cn(
                            "text-xs font-medium border whitespace-nowrap",
                            homework.status ? statusColors[homework.status] : statusColors.payment_approval
                        )}
                    >
                        {homework.status ? homework.status.replace(/_/g, ' ').toUpperCase() : 'PAYMENT APPROVAL'}
                    </Badge>
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                    Order ID: {homework.id}
                </CardDescription>
            </CardHeader>
            <CardContent className="pb-2">
                <div className="space-y-2">
                    {homework.projectNumber && homework.projectNumber.length > 0 && (
                        <p className="text-sm">
                            <span className="font-medium">Project:</span> {homework.projectNumber.join(', ')}
                        </p>
                    )}
                    {homework.deadline && (
                        <p className="text-sm">
                            <span className="font-medium">Deadline:</span> {new Date(homework.deadline).toLocaleDateString()}
                        </p>
                    )}
                    {homework.price && (
                        <p className="text-sm">
                            <span className="font-medium">Price:</span> ${homework.price}
                        </p>
                    )}
                    {homework.wordCount && (
                        <p className="text-sm">
                            <span className="font-medium">Word Count:</span> {homework.wordCount}
                        </p>
                    )}
                </div>
            </CardContent>
            <CardFooter className="pt-2">
                <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full"
                    onClick={(e) => {
                        e.stopPropagation();
                        handleCardClick();
                    }}
                >
                    View Details
                </Button>
            </CardFooter>
        </Card>
    );
});

export default HomeworkCard;