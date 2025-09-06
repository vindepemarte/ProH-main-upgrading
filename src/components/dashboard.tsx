"use client"

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAppContext } from "@/contexts/app-context";
import HomeworkList from "./dashboard/homework-list";
import LazyAnalytics from "./dashboard/lazy-analytics";
import SettingsView from "./dashboard/settings-view";
import NotificationsView from "./dashboard/notifications-view";
import UsersView from "./dashboard/users-view";
import HomeworkModal from "./modals/homework-modal";
import NewHomeworkStepperModal from "./modals/new-homework-stepper-modal";
import { PlusCircle, BookOpen, BarChart3, Bell, Settings, Users } from "lucide-react";
import { Badge } from "./ui/badge";
import RequestChangesModal from "./modals/request-changes-modal";
import SuperWorkerChangeModal from "./modals/super-worker-change-modal";
import FileUploadModal from "./modals/file-upload-modal";
import Confetti from 'react-confetti';
import { useEffect } from 'react';
import { BetaBadge } from "@/components/ui/beta-badge";

export default function Dashboard() {
    const { user, isHomeworkModalOpen, setIsHomeworkModalOpen, isNewHomeworkModalOpen, setIsNewHomeworkModalOpen, unreadNotificationCount, handleMarkNotificationsAsRead, isRequestChangesModalOpen, setIsRequestChangesModalOpen, isSuperWorkerChangeModalOpen, setIsSuperWorkerChangeModalOpen, isFileUploadModalOpen, setIsFileUploadModalOpen, showConfetti, setShowConfetti } = useAppContext();

    useEffect(() => {
        if (showConfetti) {
            const timer = setTimeout(() => {
                setShowConfetti(false);
            }, 5000);
            return () => clearTimeout(timer);
        }
    }, [showConfetti, setShowConfetti]);

    if (!user) return null;

    const onTabChange = (value: string) => {
        if (value === 'notifications' && unreadNotificationCount > 0) {
            handleMarkNotificationsAsRead();
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-background to-muted/20 pb-20 sm:pb-16">
            <header className="p-4 border-b bg-background/95 backdrop-blur-sm shadow-sm">
                <div className="flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="text-center sm:text-left flex flex-col sm:flex-row items-center gap-2">
                        <div>
                            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
                                Welcome, {user.name}
                            </h1>
                            <p className="text-muted-foreground capitalize text-sm sm:text-base">
                                {user.role.replace(/_/g, ' ')} Dashboard
                            </p>
                        </div>
                        <BetaBadge className="mt-1 sm:mt-0" />
                    </div>
                    {user.role === 'student' && (
                        <Button 
                            onClick={() => setIsNewHomeworkModalOpen(true)}
                            className="w-full sm:w-auto shadow-lg hover:shadow-xl transition-all duration-200"
                            size="lg"
                        >
                            <PlusCircle className="mr-2 h-5 w-5" /> 
                            New Homework
                        </Button>
                    )}
                </div>
            </header>
            <Tabs defaultValue="homeworks" className="w-full" onValueChange={onTabChange}>
                <div className="px-4 py-3">
                    <TabsList className="grid h-12 sm:h-16 bg-muted/50 backdrop-blur-sm rounded-xl p-1 shadow-sm dashboard-tabs" 
                              style={{
                                  gridTemplateColumns: user.role === 'super_agent' ? 'repeat(5, 1fr)' : 'repeat(3, 1fr)'
                              }}>
                        <TabsTrigger 
                            value="homeworks" 
                            className="tab-trigger flex flex-col items-center gap-1 px-2 py-2 sm:py-4 sm:px-4 text-xs font-medium transition-all duration-200 data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg mb-1"
                        >
                            <BookOpen className="h-5 w-5 tab-icon" />
                            <span className="hidden sm:inline">Homeworks</span>
                        </TabsTrigger>
                        
                        {/* Analytics visible to all roles */}
                        <TabsTrigger 
                            value="analytics" 
                            className="tab-trigger flex flex-col items-center gap-1 px-2 py-2 sm:py-4 sm:px-4 text-xs font-medium transition-all duration-200 data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg mb-1"
                        >
                            <BarChart3 className="h-5 w-5 tab-icon" />
                            <span className="hidden sm:inline">Analytics</span>
                        </TabsTrigger>
                        
                        <TabsTrigger 
                            value="notifications" 
                            className="tab-trigger flex flex-col items-center gap-1 px-2 py-2 sm:py-4 sm:px-4 text-xs font-medium transition-all duration-200 data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg mb-1 relative"
                        >
                            <div className="relative">
                                <Bell className="h-5 w-5 tab-icon" />
                                {unreadNotificationCount > 0 && (
                                    <Badge className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 bg-red-500 text-white text-xs animate-pulse">
                                        {unreadNotificationCount}
                                    </Badge>
                                )}
                            </div>
                            <span className="hidden sm:inline">Notifications</span>
                        </TabsTrigger>
                        
                        {/* Super Agent: Additional management features */}
                        {user.role === 'super_agent' && (
                            <>
                                <TabsTrigger 
                                    value="settings" 
                                    className="tab-trigger flex flex-col items-center gap-1 px-2 py-2 sm:py-4 sm:px-4 text-xs font-medium transition-all duration-200 data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg mb-1"
                                >
                                    <Settings className="h-5 w-5 tab-icon" />
                                    <span className="hidden sm:inline">Settings</span>
                                </TabsTrigger>
                                <TabsTrigger 
                                    value="users" 
                                    className="tab-trigger flex flex-col items-center gap-1 px-2 py-2 sm:py-4 sm:px-4 text-xs font-medium transition-all duration-200 data-[state=active]:bg-accent data-[state=active]:text-white data-[state=active]:shadow-sm rounded-lg mb-1"
                                >
                                    <Users className="h-5 w-5 tab-icon" />
                                    <span className="hidden sm:inline">Users</span>
                                </TabsTrigger>
                            </>
                        )}
                    </TabsList>
                </div>

                <div className="px-4 pb-4">
                    <TabsContent value="homeworks" className="mt-0">
                        <HomeworkList />
                    </TabsContent>
                    {/* Analytics tab content - available to all roles */}
                    <TabsContent value="analytics" className="mt-0">
                        <LazyAnalytics />
                    </TabsContent>
                    <TabsContent value="notifications" className="mt-0">
                        <NotificationsView />
                    </TabsContent>
                    {user.role === 'super_agent' && (
                        <>
                            <TabsContent value="settings" className="mt-0">
                                <SettingsView />
                            </TabsContent>
                            <TabsContent value="users" className="mt-0">
                                <UsersView />
                            </TabsContent>
                        </>
                    )}
                </div>
            </Tabs>
            <HomeworkModal open={isHomeworkModalOpen} onOpenChange={setIsHomeworkModalOpen} />
            <NewHomeworkStepperModal open={isNewHomeworkModalOpen} onOpenChange={setIsNewHomeworkModalOpen} />
            <RequestChangesModal open={isRequestChangesModalOpen} onOpenChange={setIsRequestChangesModalOpen} />
            <SuperWorkerChangeModal open={isSuperWorkerChangeModalOpen} onOpenChange={setIsSuperWorkerChangeModalOpen} />
            <FileUploadModal open={isFileUploadModalOpen} onOpenChange={setIsFileUploadModalOpen} />
            {showConfetti && <Confetti width={window.innerWidth} height={window.innerHeight} />}
        </div>
    );
}
