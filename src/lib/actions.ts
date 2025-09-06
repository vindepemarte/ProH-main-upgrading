
'use server';

import { pool } from './db';
import type { User, Homework, HomeworkStatus, ReferenceCode, ProjectNumber, AnalyticsData, PricingConfig, Notification, UserRole, SuperAgentDashboardStats, StudentsPerAgent, HomeworkChangeRequestData, HomeworkChangeRequest, NotificationTemplates, SuperWorkerFee, SuperWorkerWithFee } from './types';
import { differenceInDays, format, addDays } from 'date-fns';

const hash = (pwd: string) => `hashed_${pwd}`;
const compare = (pwd: string, hashed: string) => hash(pwd) === hashed;

// Test function to verify notification system works
export async function testNotificationSystem(): Promise<{ success: boolean; message: string }> {
    try {
        // Initialize schema
        await initializeNotificationsSchema();
        
        // Test fetching notifications for a test user
        const testUserId = 'test_user_id';
        const notifications = await fetchNotificationsForUser(testUserId);
        
        return {
            success: true,
            message: `Notification system working correctly. Found ${notifications.length} notifications.`
        };
    } catch (error) {
        console.error('Notification system test failed:', error);
        return {
            success: false,
            message: `Notification system test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }
}
export async function initializeNotificationsSchema(): Promise<void> {
    const client = await pool.connect();
    try {
        // Check if source column exists and add it if it doesn't
        const columnCheck = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'notifications' AND column_name = 'source'
        `);
        
        if (columnCheck.rows.length === 0) {
            await client.query(`
                ALTER TABLE notifications 
                ADD COLUMN source VARCHAR(20) DEFAULT 'system'
            `);
            console.log('Added source column to notifications table');
        }
    } catch (error) {
        console.error('Error initializing notifications schema:', error);
    } finally {
        client.release();
    }
}

export async function fetchUsers(): Promise<User[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT u.id, u.name, u.email, u.role, r.name as referred_by_name
            FROM users u
            LEFT JOIN users r ON u.referred_by = r.id
            ORDER BY u.name
        `);
        return res.rows.map(row => ({
            ...row,
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            referredBy: row.referred_by_name || 'N/A',
        }));
    } finally {
        client.release();
    }
}

export async function authenticateUser(email: string, pass: string): Promise<User | null> {
    const client = await pool.connect();
    try {
        const res = await client.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        if (res.rows.length > 0) {
            const user = res.rows[0];
            if (compare(pass, user.password_hash)) {
                const { password_hash, ...userWithoutPassword } = user;
                return userWithoutPassword;
            }
        }
        return null;
    } finally {
        client.release();
    }
}

export async function createUser(name: string, email: string, pass: string, refCode: string, termsAccepted: boolean = false): Promise<User | null> {
    const client = await pool.connect();
    let notificationOwnerId: string | null = null;
    let newUserName: string | null = null;
    let newUserRole: UserRole | null = null;

    try {
        await client.query('BEGIN');

        const codeRes = await client.query('SELECT * FROM reference_codes WHERE code = $1', [refCode.toUpperCase()]);
        if (codeRes.rows.length === 0) {
            throw new Error("Invalid reference code.");
        }
        const code = codeRes.rows[0];

        const emailRes = await client.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        if (emailRes.rows.length > 0) {
            throw new Error("Email already in use.");
        }
        
        const newUserId = `user_${Date.now()}`;
        const newUser: Omit<User, 'id' | 'referenceCode'> & { password_hash: string } = {
            name,
            email: email.toLowerCase(),
            password_hash: hash(pass),
            role: code.role,
            referredBy: code.owner_id,
        };
        
        const insertRes = await client.query(
            `INSERT INTO users (id, name, email, password_hash, role, referred_by, terms_accepted, terms_accepted_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, ${termsAccepted ? 'CURRENT_TIMESTAMP' : 'NULL'}) RETURNING *`,
            [newUserId, newUser.name, newUser.email, newUser.password_hash, newUser.role, newUser.referredBy, termsAccepted]
        );
        
        await client.query('COMMIT');
        
        if (code.owner_id) {
           notificationOwnerId = code.owner_id;
           newUserName = newUser.name;
           newUserRole = newUser.role;
        }

        const { password_hash, ...userWithoutPassword } = insertRes.rows[0];
        return userWithoutPassword;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
        
        // Send notification after the transaction is complete
        if (notificationOwnerId && newUserName && newUserRole) {
            try {
                // Check if the notification owner is the super agent to avoid duplicate notifications
                const superAgentRes = await pool.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1");
                const isSuperAgentOwner = superAgentRes.rows.length > 0 && superAgentRes.rows[0].id === notificationOwnerId;
                
                // Always notify the code owner (could be agent, super_worker, etc.)
                await createNotificationFromTemplate(
                    'userRegistration',
                    { userName: newUserName, userRole: newUserRole },
                    notificationOwnerId
                );
                
                // Only notify super agent separately if they're not already the code owner
                if (!isSuperAgentOwner && superAgentRes.rows.length > 0) {
                    await createNotificationFromTemplate(
                        'userRegistration',
                        { userName: newUserName, userRole: newUserRole },
                        superAgentRes.rows[0].id
                    );
                }
            } catch (notificationError) {
                console.error("Failed to create notification after user registration:", notificationError);
            }
        }
    }
}


// Legacy function for backward compatibility - loads all homeworks
export async function fetchHomeworksForUser(user: User): Promise<Homework[]> {
    const result = await fetchHomeworksForUserPaginated(user, 1, 1000); // Load up to 1000 for backward compatibility
    return result.homeworks;
}

// New paginated function for performance optimization
export async function fetchHomeworksForUserPaginated(
    user: User, 
    page: number = 1, 
    limit: number = 20
): Promise<{ homeworks: Homework[]; totalCount: number; hasMore: boolean; currentPage: number }> {
    const client = await pool.connect();
    const offset = (page - 1) * limit;
    
    let baseQuery = `SELECT h.*, sw.name as assigned_super_worker_name 
                     FROM homeworks h
                     LEFT JOIN users sw ON h.super_worker_id = sw.id`;
    let countQuery = `SELECT COUNT(*) as total FROM homeworks h`;
    const params: (string | HomeworkStatus[])[] = [];
    const countParams: (string | HomeworkStatus[])[] = [];
    
    switch(user.role) {
        case 'super_agent':
            break;
        case 'agent':
            baseQuery += ' JOIN users s ON h.student_id = s.id WHERE s.referred_by = $1';
            countQuery += ' JOIN users s ON h.student_id = s.id WHERE s.referred_by = $1';
            params.push(user.id);
            countParams.push(user.id);
            break;
        case 'student':
            baseQuery += ' WHERE h.student_id = $1';
            countQuery += ' WHERE h.student_id = $1';
            params.push(user.id);
            countParams.push(user.id);
            break;
        case 'super_worker':
            // Super worker only sees homeworks specifically assigned to them
            baseQuery += ' WHERE h.super_worker_id = $1';
            countQuery += ' WHERE h.super_worker_id = $1';
            params.push(user.id);
            countParams.push(user.id);
            break;
        case 'worker':
            baseQuery += ' WHERE h.worker_id = $1';
            countQuery += ' WHERE h.worker_id = $1';
            params.push(user.id);
            countParams.push(user.id);
            break;
        default:
            return { homeworks: [], totalCount: 0, hasMore: false, currentPage: page };
    }
    
    baseQuery += ' ORDER BY h.deadline DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(limit.toString(), offset.toString());

    try {
        // Get total count and paginated results in parallel
        const [countRes, res] = await Promise.all([
            client.query(countQuery, countParams),
            client.query(baseQuery, params)
        ]);
        
        const totalCount = parseInt(countRes.rows[0].total);
        const hasMore = offset + limit < totalCount;
        
        const homeworks = await Promise.all(res.rows.map(async (row) => {
            const filesRes = await client.query('SELECT file_name as name, file_url as url, file_type, is_latest, uploaded_by, uploaded_at FROM homework_files WHERE homework_id = $1 ORDER BY uploaded_at DESC', [row.id]);
            const changeRequestsRes = await client.query('SELECT * FROM homework_change_requests WHERE homework_id = $1 ORDER BY created_at DESC', [row.id]);
            
            const changeRequests = await Promise.all(changeRequestsRes.rows.map(async (cr) => {
                const crFilesRes = await client.query('SELECT file_name as name, file_url as url FROM change_request_files WHERE change_request_id = $1', [cr.id]);
                return { ...cr, files: crFilesRes.rows };
            }));

            // Separate files by type
            const allFiles = filesRes.rows;
            const originalFiles = allFiles.filter(f => f.file_type === 'student_original');
            const draftFiles = allFiles.filter(f => f.file_type === 'worker_draft' && f.is_latest);
            const reviewedFiles = allFiles.filter(f => f.file_type === 'super_worker_review' && f.is_latest);
            const finalFiles = allFiles.filter(f => f.file_type === 'final_approved' && f.is_latest);

            return {
                ...row,
                studentId: row.student_id,
                agentId: row.agent_id,
                workerId: row.worker_id,
                superWorkerId: row.super_worker_id,
                assignedSuperWorkerName: row.assigned_super_worker_name,
                moduleName: row.module_name,
                projectNumber: row.project_number, 
                wordCount: row.word_count,
                files: originalFiles, // Keep original files for backward compatibility
                draftFiles: draftFiles,
                reviewedFiles: reviewedFiles,
                finalFiles: finalFiles,
                allFiles: allFiles,
                earnings: row.earnings,
                changeRequests: changeRequests,
            };
        }));

        return {
            homeworks,
            totalCount,
            hasMore,
            currentPage: page
        };
    } finally {
        client.release();
    }
}

export async function modifyHomework(id: string, updates: Partial<Homework>): Promise<void> {
    const client = await pool.connect();
    const notificationsToSend: ({ userId: string; message?: string; templateId?: keyof NotificationTemplates; variables?: Record<string, any>; homeworkId: string })[] = [];
    
    try {
        await client.query('BEGIN');
        
        const homeworkRes = await client.query('SELECT * FROM homeworks WHERE id = $1', [id]);
        if (homeworkRes.rows.length === 0) throw new Error("Homework not found");
        const homework = homeworkRes.rows[0];

        const dbUpdates: { [key: string]: any } = {};
        if (updates.status) dbUpdates.status = updates.status;
        if (updates.workerId) {
            dbUpdates.worker_id = updates.workerId;
            dbUpdates.status = 'assigned_to_worker';
        }
        if (updates.price) dbUpdates.price = updates.price;
        if (updates.wordCount) dbUpdates.word_count = updates.wordCount;
        if (updates.deadline) dbUpdates.deadline = updates.deadline;
        if (updates.earnings) dbUpdates.earnings = JSON.stringify(updates.earnings);
        
        // Always update the updated_at timestamp when modifying
        dbUpdates.updated_at = 'CURRENT_TIMESTAMP';
        
        const setClause = Object.keys(dbUpdates).map((key, i) => {
            if (key === 'updated_at') {
                return `${key} = CURRENT_TIMESTAMP`;
            }
            return `${key} = $${i + 2}`;
        }).join(', ');
        const values = Object.values(dbUpdates).filter(v => v !== 'CURRENT_TIMESTAMP');

        if (values.length > 0) {
            const query = `UPDATE homeworks SET ${setClause} WHERE id = $1`;
            await client.query(query, [id, ...values]);
        }
        
        if (updates.status && updates.status !== homework.status) {
            const superAgentRes = await pool.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1");
            const superAgentId = superAgentRes.rows.length > 0 ? superAgentRes.rows[0].id : null;
            const messageBase = `Homework #${homework.id} status updated to "${updates.status.replace(/_/g, ' ')}".`

            // Enhanced notification system for all status changes
            switch (updates.status) {
                case 'assigned_to_super_worker':
                    // Notify assigned super worker
                    if (homework.super_worker_id) {
                        notificationsToSend.push({ userId: homework.super_worker_id, templateId: 'workerAssignment', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, message: messageBase, homeworkId: id });
                    }
                    break;
                    
                case 'assigned_to_worker':
                    // Notify assigned worker
                    if (homework.worker_id) {
                        notificationsToSend.push({ userId: homework.worker_id, templateId: 'workerAssignment', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super worker about assignment
                    if (homework.super_worker_id) {
                        notificationsToSend.push({ userId: homework.super_worker_id, message: messageBase, homeworkId: id });
                    }
                    break;
                    
                case 'in_progress':
                    // Notify super worker and assigned worker
                    const superWorkerRes = await pool.query("SELECT id FROM users WHERE role = 'super_worker' LIMIT 1");
                    if (superWorkerRes.rows.length > 0) {
                        notificationsToSend.push({ userId: superWorkerRes.rows[0].id, templateId: 'homeworkInProgress', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    if (homework.worker_id) {
                        notificationsToSend.push({ userId: homework.worker_id, templateId: 'workerAssignment', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, templateId: 'homeworkInProgress', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    break;
                    
                case 'worker_draft':
                    // Notify super worker about worker draft
                    if (homework.super_worker_id) {
                        notificationsToSend.push({ userId: homework.super_worker_id, templateId: 'workerDraftUpload', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, templateId: 'workerDraftUpload', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    break;
                    
                case 'final_payment_approval':
                    // Notify super agent for final approval
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, templateId: 'finalPaymentApproval', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify student that work is being reviewed
                    notificationsToSend.push({ userId: homework.student_id, templateId: 'finalReview', variables: { homeworkId: homework.id }, homeworkId: id });
                    break;
                    
                case 'completed':
                    // Notify student that work is complete  
                    notificationsToSend.push({ userId: homework.student_id, templateId: 'homeworkCompleted', variables: { homeworkId: homework.id }, homeworkId: id });
                    // Notify agent if homework has one
                    if (homework.agent_id) {
                        notificationsToSend.push({ userId: homework.agent_id, templateId: 'homeworkCompletedAgent', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, templateId: 'homeworkCompletedSuperAgent', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    break;
                    
                case 'requested_changes':
                    // Notify super worker and worker about requested changes
                    const superWorkerForChanges = await pool.query("SELECT id FROM users WHERE role = 'super_worker' LIMIT 1");
                    if (superWorkerForChanges.rows.length > 0) {
                        notificationsToSend.push({ userId: superWorkerForChanges.rows[0].id, templateId: 'changeRequest', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    if (homework.worker_id) {
                        notificationsToSend.push({ userId: homework.worker_id, templateId: 'changeRequest', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, templateId: 'changeRequest', variables: { homeworkId: homework.id }, homeworkId: id });
                    }
                    break;
                    
                case 'word_count_change':
                case 'deadline_change':
                    // Notify super agent about change requests
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, message: messageBase, homeworkId: id });
                    }
                    break;
                    
                case 'declined':
                case 'refund':
                    // Notify student about decline/refund
                    notificationsToSend.push({ userId: homework.student_id, message: messageBase, homeworkId: id });
                    // Notify agent if homework has one
                    if (homework.agent_id) {
                        notificationsToSend.push({ userId: homework.agent_id, message: `Homework #${homework.id} has been ${updates.status}.`, homeworkId: id });
                    }
                    // Notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, message: `Homework #${homework.id} has been ${updates.status}.`, homeworkId: id });
                    }
                    break;
                    
                default:
                    // For any other status changes, notify super agent
                    if (superAgentId) {
                        notificationsToSend.push({ userId: superAgentId, message: messageBase, homeworkId: id });
                    }
            }
        }
        
        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in modifyHomework:", error);
        throw error;
    } finally {
        client.release();
        
        for (const notification of notificationsToSend) {
            try {
                if (notification.templateId && notification.variables) {
                    await createNotificationFromTemplate(
                        notification.templateId,
                        notification.variables,
                        notification.userId,
                        notification.homeworkId
                    );
                } else if (notification.message) {
                    await createNotification({
                        userId: notification.userId,
                        message: notification.message,
                        homeworkId: notification.homeworkId
                    });
                }
            } catch (notificationError) {
                console.error("Failed to create notification after homework modification:", notificationError);
            }
        }
    }
}

export async function requestChangesOnHomework(homeworkId: string, data: HomeworkChangeRequestData): Promise<void> {
    const client = await pool.connect();
    const notificationsToSend: ({ userId: string; message?: string; templateId?: keyof NotificationTemplates; variables?: Record<string, any>; homeworkId: string })[] = [];

    try {
        await client.query('BEGIN');

        const homeworkRes = await client.query('SELECT * FROM homeworks WHERE id = $1', [homeworkId]);
        if (homeworkRes.rows.length === 0) throw new Error("Homework not found");
        const homework = homeworkRes.rows[0];

        await client.query("UPDATE homeworks SET status = 'requested_changes' WHERE id = $1", [homeworkId]);

        const changeReqRes = await client.query(
            'INSERT INTO homework_change_requests (homework_id, notes) VALUES ($1, $2) RETURNING id',
            [homeworkId, data.notes]
        );
        const changeRequestId = changeReqRes.rows[0].id;

        if (data.files && data.files.length > 0) {
            for (const file of data.files) {
                await client.query(
                    'INSERT INTO change_request_files (change_request_id, file_name, file_url) VALUES ($1, $2, $3)',
                    [changeRequestId, file.name, file.url || '']
                );
            }
        }

        const superWorkerId = homework.super_worker_id || (await pool.query("SELECT id FROM users WHERE role = 'super_worker' LIMIT 1")).rows[0]?.id;
        const superAgentId = (await pool.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1")).rows[0]?.id;

        if (superWorkerId) {
            notificationsToSend.push({ userId: superWorkerId, templateId: 'changeRequest', variables: { homeworkId }, homeworkId });
        }
        if (superAgentId) {
             notificationsToSend.push({ userId: superAgentId, templateId: 'changeRequest', variables: { homeworkId }, homeworkId });
        }
        
        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in requestChangesOnHomework:", error);
        throw error;
    } finally {
        client.release();

        for (const notification of notificationsToSend) {
            try {
                if (notification.templateId && notification.variables) {
                    await createNotificationFromTemplate(
                        notification.templateId,
                        notification.variables,
                        notification.userId,
                        notification.homeworkId
                    );
                } else if (notification.message) {
                    await createNotification({
                        userId: notification.userId,
                        message: notification.message,
                        homeworkId: notification.homeworkId
                    });
                }
            } catch (notificationError) {
                console.error("Failed to create notification for change request:", notificationError);
            }
        }
    }
}

export async function requestSuperWorkerChanges(homeworkId: string, data: {
    newWordCount: number;
    newDeadline: Date;
    notes: string;
}): Promise<void> {
    const client = await pool.connect();
    const notificationsToSend: ({ userId: string; message?: string; templateId?: keyof NotificationTemplates; variables?: Record<string, any>; homeworkId: string })[] = [];

    try {
        await client.query('BEGIN');

        const homeworkRes = await client.query('SELECT * FROM homeworks WHERE id = $1', [homeworkId]);
        if (homeworkRes.rows.length === 0) throw new Error("Homework not found");
        const homework = homeworkRes.rows[0];

        // Recalculate price with new parameters
        const newPrice = await getCalculatedPrice(data.newWordCount, data.newDeadline);
        
        // Recalculate earnings with new word count
        const pricingConfig = await getPricingConfig();
        const agentFeePer500 = pricingConfig.fees.agent;
        
        // Use assigned super worker's fee if available, otherwise fall back to global fee
        const superWorkerFeePer500 = homework.super_worker_id 
            ? await getWorkerFee(homework.super_worker_id)
            : pricingConfig.fees.super_worker;
        
        // Get student to check if they have an agent referrer
        const studentRes = await client.query('SELECT * FROM users WHERE id = $1', [homework.student_id]);
        const student = studentRes.rows[0];
        
        let agent = null;
        if (student.referred_by) {
            const referrerRes = await client.query('SELECT * FROM users WHERE id = $1', [student.referred_by]);
            const referrer = referrerRes.rows[0];
            if (referrer && referrer.role === 'agent') {
                agent = referrer;
            }
        }
        
        const agentPay = agent ? (agentFeePer500 * (data.newWordCount / 500)) : 0;
        const superWorkerPay = superWorkerFeePer500 * (data.newWordCount / 500);
        const profit = newPrice - agentPay - superWorkerPay;

        const newEarnings = {
            total: newPrice,
            agent: agentPay > 0 ? agentPay : undefined,
            super_worker: superWorkerPay,
            profit: profit
        };

        // Determine change type
        const isWordCountChange = data.newWordCount !== homework.word_count;
        const isDeadlineChange = new Date(data.newDeadline).getTime() !== new Date(homework.deadline).getTime();
        const changeType = isWordCountChange ? 'word_count_change' : 'deadline_change';
        
        // Update homework with new values and set appropriate status
        await client.query(
            'UPDATE homeworks SET word_count = $1, deadline = $2, price = $3, earnings = $4, status = $5 WHERE id = $6',
            [data.newWordCount, data.newDeadline, newPrice, JSON.stringify(newEarnings), changeType, homeworkId]
        );

        // Create change request record
        await client.query(
            'INSERT INTO homework_change_requests (homework_id, notes) VALUES ($1, $2)',
            [homeworkId, data.notes]
        );

        // Send notifications
        const superAgentRes = await client.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1");
        const superAgentId = superAgentRes.rows.length > 0 ? superAgentRes.rows[0].id : null;
        
        const oldPrice = homework.price || 0;
        const priceDifference = newPrice - oldPrice;
        const changeDescription = isWordCountChange ? `word count to ${data.newWordCount}` : `deadline to ${new Date(data.newDeadline).toLocaleDateString()}`;
        const priceInfo = priceDifference !== 0 ? ` Price ${priceDifference > 0 ? 'increased' : 'decreased'} by £${Math.abs(priceDifference).toFixed(2)}.` : '';
        
        if (superAgentId) {
            notificationsToSend.push({ 
                userId: superAgentId, 
                templateId: 'superWorkerChangeRequest',
                variables: { homeworkId, changeDescription, priceInfo },
                homeworkId 
            });
        }
        
        // Notify student about the change request
        notificationsToSend.push({ 
            userId: homework.student_id, 
            templateId: 'superWorkerChangeRequest',
            variables: { homeworkId, changeDescription, priceInfo: `${priceInfo} Please approve or decline.` },
            homeworkId 
        });
        
        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in requestSuperWorkerChanges:", error);
        throw error;
    } finally {
        client.release();

        for (const notification of notificationsToSend) {
            try {
                if (notification.templateId && notification.variables) {
                    await createNotificationFromTemplate(
                        notification.templateId,
                        notification.variables,
                        notification.userId,
                        notification.homeworkId
                    );
                } else if (notification.message) {
                    await createNotification({
                        userId: notification.userId,
                        message: notification.message,
                        homeworkId: notification.homeworkId
                    });
                }
            } catch (notificationError) {
                console.error("Failed to create notification for super worker change request:", notificationError);
            }
        }
    }
}


export async function fetchWorkersForSuperWorker(superWorkerId: string): Promise<User[]> {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT id, name, email, role FROM users WHERE role = 'worker' AND referred_by = $1", [superWorkerId]);
        return res.rows;
    } finally {
        client.release();
    }
}

export async function fetchAllReferenceCodes(): Promise<ReferenceCode[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT rc.code, rc.role, rc.owner_id as "ownerId", u.name as "ownerName", u.email as "ownerEmail"
            FROM reference_codes rc
            LEFT JOIN users u ON rc.owner_id = u.id
        `);
        return res.rows;
    } finally {
        client.release();
    }
}

export async function updateReferenceCode(oldCode: string, newCode: string): Promise<ReferenceCode> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const existingCodeRes = await client.query('SELECT * FROM reference_codes WHERE code = $1', [newCode.toUpperCase()]);
        if (existingCodeRes.rows.length > 0) {
            throw new Error(`Reference code "${newCode.toUpperCase()}" already exists.`);
        }
        
        const res = await client.query("UPDATE reference_codes SET code = $1 WHERE code = $2 RETURNING *", [newCode.toUpperCase(), oldCode]);
        if(res.rows.length === 0) throw new Error("Original code not found");

        await client.query('COMMIT');
        return res.rows[0];
    } catch(e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

export async function createReferenceCode(code: string, role: UserRole, ownerId: string): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query(
            "INSERT INTO reference_codes (code, role, owner_id) VALUES ($1, $2, $3)",
            [code.toUpperCase(), role, ownerId]
        );
    } catch (error: any) {
        if (error.code === '23505') { 
            throw new Error(`Reference code "${code.toUpperCase()}" already exists.`);
        }
        throw error;
    } finally {
        client.release();
    }
}


export async function createHomework(
    student: User,
    data: {
        moduleName: string;
        projectNumber: ProjectNumber[];
        wordCount: number;
        deadline: Date;
        notes: string;
        files: { name: string; url: string }[];
        assignedSuperWorkerId?: string; // Optional super worker assignment
    }
): Promise<{homework: Homework, message: string}> {
    const client = await pool.connect();
    // Generate exactly 5-character homework ID
    const generateHomeworkId = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let result = '';
        for (let i = 0; i < 5; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    };
    const homeworkId = generateHomeworkId();
    let createdHomework: Homework | null = null;
    let message: string = '';
    
    let notificationDetails: { userId: string; message: string; homeworkId: string } | null = null;

    try {
        await client.query('BEGIN');
        
        const pricingConfig = await getPricingConfig();
        const studentDetails = (await client.query('SELECT * FROM users WHERE id = $1', [student.id])).rows[0];
        
        // Only calculate agent pay if student was referred by an actual agent (not super_agent)
        let agent = null;
        if (studentDetails.referred_by) {
            const referrer = (await client.query('SELECT * FROM users WHERE id = $1', [studentDetails.referred_by])).rows[0];
            // Only treat as agent if referrer's role is actually 'agent'
            if (referrer && referrer.role === 'agent') {
                agent = referrer;
            }
        }
        
        const finalPrice = await getCalculatedPrice(data.wordCount, data.deadline);

        const agentFeePer500 = pricingConfig.fees.agent;
        
        // Get super worker fee (either from assigned worker or global config)
        const superWorkerFeePer500 = data.assignedSuperWorkerId 
            ? await getWorkerFee(data.assignedSuperWorkerId)
            : pricingConfig.fees.super_worker;
        
        // Agent pay ONLY if student was referred by an actual agent
        const agentPay = agent ? (agentFeePer500 * (data.wordCount / 500)) : 0;
        const superWorkerPay = superWorkerFeePer500 * (data.wordCount / 500);
        const profit = finalPrice - agentPay - superWorkerPay;

        const earnings = {
            total: finalPrice,
            agent: agentPay > 0 ? agentPay : undefined,
            super_worker: superWorkerPay,
            profit: profit
        };
        
        const res = await client.query(
            `INSERT INTO homeworks 
            (id, student_id, agent_id, super_worker_id, status, module_name, project_number, word_count, deadline, notes, price, earnings, created_at, updated_at) 
            VALUES ($1, $2, $3, $4, 'payment_approval', $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) RETURNING *`,
            [homeworkId, student.id, agent?.id, data.assignedSuperWorkerId || null, data.moduleName, data.projectNumber, data.wordCount, data.deadline, data.notes, finalPrice, JSON.stringify(earnings)]
        );

        if (data.files && data.files.length > 0) {
            for (const file of data.files) {
                 await client.query(
                    'INSERT INTO homework_files (homework_id, file_name, file_url) VALUES ($1, $2, $3)',
                    [homeworkId, file.name, file.url || '']
                );
            }
        }
        
        const createdHomeworkRow = res.rows[0];
        createdHomework = {
            ...createdHomeworkRow,
             studentId: createdHomeworkRow.student_id,
            agentId: createdHomeworkRow.agent_id,
            workerId: createdHomeworkRow.worker_id,
            superWorkerId: createdHomeworkRow.super_worker_id,
            moduleName: createdHomeworkRow.module_name,
            projectNumber: createdHomeworkRow.project_number, 
            wordCount: createdHomeworkRow.word_count,
            files: data.files,
            earnings: createdHomeworkRow.earnings
        };
        message = `Your homework has been submitted successfully. The total price is £${finalPrice.toFixed(2)}. Please use the homework ID #${homeworkId} as the reference for your payment.`;
        
        await client.query('COMMIT');

    } catch(e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
    
    // Create notification after transaction is committed
    const superAgentRes = await pool.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1");
    if (superAgentRes.rows.length > 0) {
        try {
            await createNotificationFromTemplate(
                'newHomeworkSubmission',
                { homeworkId: homeworkId, studentName: student.name },
                superAgentRes.rows[0].id,
                homeworkId
            );
        } catch (notificationError) {
            console.error("Failed to create notification after homework creation:", notificationError);
        }
    }
    
    // Send homework submitted notification to student with payment details
    try {
        await createNotificationFromTemplate(
            'homeworkSubmitted',
            { 
                referenceCode: homeworkId, 
                paymentAmount: createdHomework!.price!.toFixed(2),
                bankDetails: 'Account: ProH Academic Services, Sort Code: 12-34-56, Account Number: 12345678'
            },
            student.id,
            homeworkId
        );
    } catch (notificationError) {
        console.error("Failed to create homework submitted notification:", notificationError);
    }
    
    // If a super worker was assigned, notify them
    if (data.assignedSuperWorkerId) {
        try {
            await createNotificationFromTemplate(
                'workerAssignment',
                { homeworkId },
                data.assignedSuperWorkerId,
                homeworkId
            );
        } catch (notificationError) {
            console.error("Failed to create worker assignment notification:", notificationError);
        }
    }

    return { homework: createdHomework!, message: message! };
}

export async function getAnalyticsForUser(user: User, from?: Date, to?: Date): Promise<AnalyticsData> {
    const client = await pool.connect();
    
    const fromDate = from || new Date('1970-01-01');
    const toDate = to || new Date();

    const dateRangeInDays = differenceInDays(toDate, fromDate);
    const groupByMonth = dateRangeInDays > 31;
    const dateFormat = groupByMonth ? 'YYYY-MM' : 'YYYY-MM-DD';
    
    try {
        let metric1Query = '';
        let metric2Query = '';
        const params: (string | Date)[] = [ format(fromDate, 'yyyy-MM-dd'), format(addDays(toDate, 1), 'yyyy-MM-dd') ];

        // Use created_at instead of deadline for filtering based on submission dates
        const dateFilter = ` AND created_at::date BETWEEN $1 AND $2`;
        let userFilter = '';

        const groupByClause = `GROUP BY 1 ORDER BY 1`;

        switch(user.role) {
            case 'student':
                // Student: Spending Overview (total spent) + Submissions (count of homeworks)
                // ONLY exclude 'refund' status as per user requirements
                userFilter = ` AND student_id = $3`;
                params.push(user.id);
                metric1Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, SUM(price) as value FROM homeworks WHERE status != 'refund' ${dateFilter} ${userFilter} ${groupByClause}`;
                metric2Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, COUNT(*) as value FROM homeworks WHERE status != 'refund' ${dateFilter} ${userFilter} ${groupByClause}`;
                break;
                
            case 'agent':
                // Agent: Profit from their students' homeworks (payment tracking after payment_approval)
                userFilter = ` AND h.student_id IN (SELECT id FROM users WHERE referred_by = $3)`;
                params.push(user.id);
                metric1Query = `SELECT TO_CHAR(h.created_at, '${dateFormat}') as date, 
                    SUM(CASE 
                        WHEN h.status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (h.earnings->>'agent')::numeric 
                        WHEN h.status IN ('declined', 'refund') 
                        THEN -(h.earnings->>'agent')::numeric 
                        ELSE 0 
                    END) as value 
                FROM homeworks h WHERE h.earnings->>'agent' IS NOT NULL ${dateFilter} ${userFilter} ${groupByClause}`;
                metric2Query = `SELECT TO_CHAR(h.created_at, '${dateFormat}') as date, COUNT(*) as value FROM homeworks h WHERE h.status NOT IN ('refund') ${dateFilter} ${userFilter} ${groupByClause}`;
                break;
                
            case 'worker':
                // Worker: NO STATS/CHARTS as per requirements
                return { metric1: [], metric2: [] };
                
            case 'super_worker':
                // Super Worker: Fee earnings + assignments specifically assigned to them (payment tracking after payment_approval)
                userFilter = ` AND super_worker_id = $3`;
                params.push(user.id);
                metric1Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, 
                    SUM(CASE 
                        WHEN status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (earnings->>'super_worker')::numeric 
                        WHEN status IN ('declined', 'refund') 
                        THEN -(earnings->>'super_worker')::numeric 
                        ELSE 0 
                    END) as value 
                FROM homeworks WHERE earnings->>'super_worker' IS NOT NULL ${dateFilter} ${userFilter} ${groupByClause}`;
                metric2Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, COUNT(*) as value FROM homeworks WHERE status NOT IN ('refund') ${dateFilter} ${userFilter} ${groupByClause}`;
                break;
                
            case 'super_agent':
                // Super Agent: Total Revenue (full price) + Total Assignments (minus refunded)
                metric1Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, SUM(price) as value FROM homeworks WHERE status != 'refund' ${dateFilter} ${groupByClause}`;
                metric2Query = `SELECT TO_CHAR(created_at, '${dateFormat}') as date, COUNT(*) as value FROM homeworks WHERE status != 'refund' ${dateFilter} ${groupByClause}`;
                break;
                
            default:
                return { metric1: [], metric2: [] };
        }

        const [metric1Res, metric2Res] = await Promise.all([
             client.query(metric1Query, params),
             client.query(metric2Query, params)
        ]);

        const formatAnalytics = (rows: any[]) => {
            return rows.map(r => ({
                date: r.date,
                value: parseFloat(r.value) || 0
            }));
        }

        return {
            metric1: formatAnalytics(metric1Res.rows),
            metric2: formatAnalytics(metric2Res.rows),
        };

    } finally {
        client.release();
    }
}

export async function getSuperAgentDashboardStats(from?: Date, to?: Date): Promise<SuperAgentDashboardStats> {
    const client = await pool.connect();
    
    const fromDate = from || new Date('1970-01-01');
    const toDate = to || new Date();
    
    try {
        const params: (string | Date)[] = [ format(fromDate, 'yyyy-MM-dd'), format(addDays(toDate, 1), 'yyyy-MM-dd') ];
        const dateFilter = ` AND created_at::date BETWEEN $1 AND $2`;
        
        // Calculate current month for payment calculations
        const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const currentMonthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
        const monthParams = [format(currentMonthStart, 'yyyy-MM-dd'), format(addDays(currentMonthEnd, 1), 'yyyy-MM-dd')];
        const monthFilter = ` AND created_at::date BETWEEN $1 AND $2`;
        
        const statsRes = await client.query(`
             SELECT 
                (SELECT COALESCE(SUM(price), 0) FROM homeworks WHERE status != 'refund' ${dateFilter}) as total_revenue,
                (SELECT COALESCE(SUM((earnings->>'profit')::numeric), 0) FROM homeworks WHERE status != 'refund' AND earnings->>'profit' IS NOT NULL ${dateFilter}) as total_profit,
                (SELECT COUNT(*) FROM users WHERE role = 'student') as total_students,
                (SELECT COUNT(*) FROM homeworks WHERE status != 'refund' ${dateFilter}) as total_homeworks
        `, params);
        
        const { total_revenue, total_profit, total_students, total_homeworks } = statsRes.rows[0];
        const homeworkCount = parseInt(total_homeworks, 10);
        
        // Platform fee is £0.50 per homework (minus refunded homeworks)
        const platformFeePerHomework = 0.50;
        const totalPlatformFees = homeworkCount * platformFeePerHomework;
        
        const average_profit_per_homework = homeworkCount > 0 ? parseFloat(total_profit) / homeworkCount : 0;
        
        // Calculate "To be paid" amounts for current month (from homeworks past payment_approval, minus declined/refunded)
        const paymentStatsRes = await client.query(`
            SELECT 
                (SELECT COALESCE(
                    SUM(CASE 
                        WHEN status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (earnings->>'super_worker')::numeric 
                        WHEN status IN ('declined', 'refund') 
                        THEN -(earnings->>'super_worker')::numeric 
                        ELSE 0 
                    END), 0
                ) FROM homeworks WHERE earnings->>'super_worker' IS NOT NULL ${monthFilter}) as to_be_paid_super_worker,
                (SELECT COALESCE(
                    SUM(CASE 
                        WHEN status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (earnings->>'agent')::numeric 
                        WHEN status IN ('declined', 'refund') 
                        THEN -(earnings->>'agent')::numeric 
                        ELSE 0 
                    END), 0
                ) FROM homeworks WHERE earnings->>'agent' IS NOT NULL ${monthFilter}) as to_be_paid_agents
        `, monthParams);
        
        const { to_be_paid_super_worker, to_be_paid_agents } = paymentStatsRes.rows[0];
        
        // Students per Agent with current month payments (from homeworks past payment_approval, minus declined/refunded)
        const agentStudentsRes = await client.query(`
            SELECT 
                u.name as "agentName", 
                COUNT(DISTINCT s.id) as "studentCount",
                COALESCE(
                    SUM(CASE 
                        WHEN h.status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (h.earnings->>'agent')::numeric 
                        WHEN h.status IN ('declined', 'refund') 
                        THEN -(h.earnings->>'agent')::numeric 
                        ELSE 0 
                    END), 0
                ) as "toBePaid",
                COUNT(CASE WHEN h.status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') THEN 1 END) as "completedHomeworks"
            FROM users u
            LEFT JOIN users s ON s.referred_by = u.id
            LEFT JOIN homeworks h ON h.student_id = s.id AND h.created_at::date BETWEEN $1 AND $2
            WHERE u.role = 'agent'
            GROUP BY u.id, u.name
            ORDER BY "studentCount" DESC
        `, monthParams);
        
        // Super Workers data with current month payments (from homeworks past payment_approval, minus declined/refunded)
        const superWorkersRes = await client.query(`
            SELECT 
                u.name as "superWorkerName",
                COALESCE(
                    SUM(CASE 
                        WHEN h.status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') 
                        THEN (h.earnings->>'super_worker')::numeric 
                        WHEN h.status IN ('declined', 'refund') 
                        THEN -(h.earnings->>'super_worker')::numeric 
                        ELSE 0 
                    END), 0
                ) as "toBePaid",
                COUNT(CASE WHEN h.status IN ('assigned_to_super_worker', 'assigned_to_worker', 'in_progress', 'worker_draft', 'requested_changes', 'final_payment_approval', 'word_count_change', 'deadline_change', 'completed') THEN 1 END) as "assignmentsDone"
            FROM users u
            LEFT JOIN homeworks h ON h.super_worker_id = u.id AND h.created_at::date BETWEEN $1 AND $2
            WHERE u.role = 'super_worker'
            GROUP BY u.id, u.name
            ORDER BY "assignmentsDone" DESC
        `, monthParams);
        
        return {
            totalRevenue: parseFloat(total_revenue),
            totalProfit: parseFloat(total_profit),
            totalStudents: parseInt(total_students, 10),
            averageProfitPerHomework: average_profit_per_homework,
            totalPlatformFees: totalPlatformFees,
            toBePaidSuperWorker: parseFloat(to_be_paid_super_worker),
            toBePaidAgents: parseFloat(to_be_paid_agents),
            studentsPerAgent: agentStudentsRes.rows.map(r => ({
                agentName: r.agentName,
                studentCount: Number(r.studentCount),
                toBePaid: parseFloat(r.toBePaid) || 0
            })),
            superWorkersData: superWorkersRes.rows.map(r => ({
                superWorkerName: r.superWorkerName,
                toBePaid: parseFloat(r.toBePaid) || 0,
                assignmentsDone: Number(r.assignmentsDone)
            }))
        };

    } finally {
        client.release();
    }
}


export async function getPricingConfig(): Promise<PricingConfig> {
    const client = await pool.connect();
    try {
        const res = await client.query("SELECT config FROM pricing_config WHERE id = 'main'");
        if (res.rows.length === 0) {
            throw new Error("Pricing config not found");
        }
        return res.rows[0].config;
    } finally {
        client.release();
    }
}

export async function savePricingConfig(config: PricingConfig): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("UPDATE pricing_config SET config = $1 WHERE id = 'main'", [config]);
    } finally {
        client.release();
    }
}

export async function updateUserProfile(userId: string, updates: { name?: string; email?: string; password?: string }): Promise<User> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const dbUpdates: { [key: string]: any } = {};
        if (updates.name) dbUpdates.name = updates.name.trim();
        if (updates.email) dbUpdates.email = updates.email.toLowerCase().trim();
        if (updates.password) dbUpdates.password_hash = hash(updates.password);
        
        if (Object.keys(dbUpdates).length === 0) {
            throw new Error('No valid updates provided');
        }
        
        // Check if email is already taken by another user
        if (updates.email) {
            const emailCheck = await client.query('SELECT id FROM users WHERE email = $1 AND id != $2', [dbUpdates.email, userId]);
            if (emailCheck.rows.length > 0) {
                throw new Error('Email is already in use by another account');
            }
        }
        
        const setClause = Object.keys(dbUpdates).map((key, i) => `${key} = $${i + 2}`).join(', ');
        const values = Object.values(dbUpdates);
        
        const query = `UPDATE users SET ${setClause} WHERE id = $1 RETURNING id, name, email, role, referred_by`;
        const result = await client.query(query, [userId, ...values]);
        
        if (result.rows.length === 0) {
            throw new Error('User not found');
        }
        
        await client.query('COMMIT');
        return result.rows[0];
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function getCalculatedPrice(wordCount: number, deadline: Date): Promise<number> {
    const pricingConfig = await getPricingConfig();
    
    const wordTiers = pricingConfig.wordTiers;
    const sortedTiers = Object.keys(wordTiers).map(Number).sort((a,b) => a - b);
    
    let basePrice = 0;

    const closestWordTier = sortedTiers.find(tier => tier >= wordCount);

    if (closestWordTier) {
        basePrice = wordTiers[closestWordTier];
    } else {
        const highestTier = sortedTiers[sortedTiers.length -1];
        const pricePerWord = wordTiers[highestTier] / highestTier;
        basePrice = pricePerWord * wordCount;
    }


    const daysUntilDeadline = differenceInDays(deadline, new Date());
    let deadlineCharge = 0;
    if (daysUntilDeadline <= 1) deadlineCharge = pricingConfig.deadlineTiers[1] || 0;
    else if (daysUntilDeadline <= 3) deadlineCharge = pricingConfig.deadlineTiers[3] || 0;
    else if (daysUntilDeadline <= 7) deadlineCharge = pricingConfig.deadlineTiers[7] || 0;
    
    return basePrice + deadlineCharge;
}

export async function uploadHomeworkFiles(homeworkId: string, files: { name: string; url: string }[], uploadedBy: string, fileType: 'worker_draft' | 'super_worker_review' | 'final_approved'): Promise<void> {
    const client = await pool.connect();
    const notificationsToSend: ({ userId: string; message?: string; templateId?: keyof NotificationTemplates; variables?: Record<string, any>; homeworkId: string })[] = [];

    try {
        await client.query('BEGIN');

        const homeworkRes = await client.query('SELECT * FROM homeworks WHERE id = $1', [homeworkId]);
        if (homeworkRes.rows.length === 0) throw new Error("Homework not found");
        const homework = homeworkRes.rows[0];

        // Mark previous files of same type as not latest
        await client.query(
            'UPDATE homework_files SET is_latest = FALSE WHERE homework_id = $1 AND file_type = $2',
            [homeworkId, fileType]
        );

        // Insert new files
        for (const file of files) {
            await client.query(
                'INSERT INTO homework_files (homework_id, file_name, file_url, uploaded_by, file_type, is_latest) VALUES ($1, $2, $3, $4, $5, TRUE)',
                [homeworkId, file.name, file.url || '', uploadedBy, fileType]
            );
        }

        // Update homework status based on file type and send notifications
        let newStatus = homework.status;
        let notificationMessage = '';
        
        if (fileType === 'worker_draft') {
            newStatus = 'worker_draft';
            // Update homework status to worker_draft
            await client.query(
                'UPDATE homeworks SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newStatus, homeworkId]
            );
        }
        
        // Get super agent for all file upload notifications
        const superAgentRes = await client.query("SELECT id FROM users WHERE role = 'super_agent' LIMIT 1");
        const superAgentId = superAgentRes.rows.length > 0 ? superAgentRes.rows[0].id : null;
        
        if (fileType === 'worker_draft') {
            newStatus = 'worker_draft';
            
            // Notify super worker
            const superWorkerRes = await client.query("SELECT id FROM users WHERE role = 'super_worker' LIMIT 1");
            if (superWorkerRes.rows.length > 0) {
                notificationsToSend.push({ 
                    userId: superWorkerRes.rows[0].id, 
                    templateId: 'workerDraftUpload',
                    variables: { homeworkId },
                    homeworkId 
                });
            }
            
            // Notify super agent about worker draft
            if (superAgentId) {
                notificationsToSend.push({ 
                    userId: superAgentId, 
                    templateId: 'workerDraftUpload',
                    variables: { homeworkId },
                    homeworkId 
                });
            }
        } else if (fileType === 'super_worker_review') {
            // Set status to final_payment_approval and notify super agent
            newStatus = 'final_payment_approval';
            
            // Update homework status
            await client.query(
                'UPDATE homeworks SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
                [newStatus, homeworkId]
            );
            
            if (superAgentId) {
                notificationsToSend.push({ 
                    userId: superAgentId, 
                    templateId: 'superWorkerReviewUpload',
                    variables: { homeworkId },
                    homeworkId 
                });
            }
        } else if (fileType === 'final_approved') {
            newStatus = 'completed';
            
            // Notify student
            notificationsToSend.push({ 
                userId: homework.student_id, 
                templateId: 'finalFilesReady',
                variables: { homeworkId },
                homeworkId 
            });
            
            // Notify super agent about completion
            if (superAgentId) {
                notificationsToSend.push({ 
                    userId: superAgentId, 
                    templateId: 'homeworkCompletedSuperAgent',
                    variables: { homeworkId },
                    homeworkId 
                });
            }
        }

        // Update homework status if it changed
        if (newStatus !== homework.status) {
            await client.query('UPDATE homeworks SET status = $1 WHERE id = $2', [newStatus, homeworkId]);
        }

        await client.query('COMMIT');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error in uploadHomeworkFiles:", error);
        throw error;
    } finally {
        client.release();

        for (const notification of notificationsToSend) {
            try {
                if (notification.templateId && notification.variables) {
                    await createNotificationFromTemplate(
                        notification.templateId,
                        notification.variables,
                        notification.userId,
                        notification.homeworkId
                    );
                } else if (notification.message) {
                    await createNotification({
                        userId: notification.userId,
                        message: notification.message,
                        homeworkId: notification.homeworkId
                    });
                }
            } catch (notificationError) {
                console.error("Failed to create notification for file upload:", notificationError);
            }
        }
    }
}

export async function fetchNotificationsForUser(userId: string): Promise<Notification[]> {
    const client = await pool.connect();
    try {
        const userRes = await client.query('SELECT role FROM users WHERE id = $1', [userId]);
        if(userRes.rows.length === 0) return [];
        const userRole = userRes.rows[0].role;
        
        let query = "SELECT *, COALESCE(source, 'system') as source FROM notifications WHERE user_id = $1";
        const params: string[] = [userId];

        if (userRole === 'super_agent') {
            query += ` OR user_id = 'super_agent_notifications'`;
        } else if (userRole === 'super_worker') {
            query += ` OR user_id = 'super_worker_notifications'`;
        }
        
        query += " ORDER BY created_at DESC";

        const res = await client.query(query, params);
        return res.rows.map(row => ({
            ...row,
            source: row.source || 'system'
        }));
    } catch (error) {
        console.error('Error fetching notifications:', error);
        // Return empty array to prevent component crashes
        return [];
    } finally {
        client.release();
    }
}


export async function createNotification({ userId, message, homeworkId, source = 'system' }: { userId: string; message: string; homeworkId?: string; source?: 'system' | 'broadcast' }): Promise<void> {
    const client = await pool.connect();
    try {
        // First ensure the table has the source column
        await client.query(`
            ALTER TABLE notifications 
            ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'system'
        `);
        
        await client.query(
            'INSERT INTO notifications (user_id, message, homework_id, source) VALUES ($1, $2, $3, $4)',
            [userId, message, homeworkId, source]
        );
    } catch (error) {
        console.error('Failed to create notification:', { userId, message, homeworkId, source, error });
        // Do not re-throw as this is often a non-critical background task
    }
    finally {
        client.release();
    }
}

export async function broadcastNotification({ targetRole, targetUser, message }: { targetRole?: UserRole, targetUser?: string, message: string }): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (targetUser) {
            await createNotification({ userId: targetUser, message, source: 'broadcast' });
        } else if (targetRole) {
            const usersRes = await client.query('SELECT id FROM users WHERE role = $1', [targetRole]);
            for (const user of usersRes.rows) {
                await createNotification({ userId: user.id, message, source: 'broadcast' });
            }
        } else {
             throw new Error("Either a target role or a target user must be specified.");
        }
        await client.query('COMMIT');
    } catch(e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

export async function updateUserRole(userId: string, newRole: UserRole): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("UPDATE users SET role = $1 WHERE id = $2", [newRole, userId]);
        await createNotificationFromTemplate(
            'roleChange',
            { newRole: newRole.replace(/_/g, ' ') },
            userId
        );
    } finally {
        client.release();
    }
}

export async function markNotificationsAsRead(userId: string): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query("UPDATE notifications SET is_read = true WHERE user_id = $1", [userId]);
    } finally {
        client.release();
    }
}

// Notification Template Management
const defaultTemplates: NotificationTemplates = {
    // User Management
    newHomeworkSubmission: {
        id: 'new_homework',
        name: 'New Homework Submission',
        description: 'Sent when a student submits new homework',
        template: 'New homework #{homeworkId} from {studentName} requires payment approval.',
        variables: ['homeworkId', 'studentName']
    },
    userRegistration: {
        id: 'user_registration',
        name: 'User Registration',
        description: 'Sent when a new user registers with a reference code',
        template: 'New user registration: {userName} ({userRole}) has joined the platform.',
        variables: ['userName', 'userRole']
    },
    roleChange: {
        id: 'role_change',
        name: 'Role Change',
        description: 'Sent when user role is changed',
        template: 'An administrator has changed your role to {newRole}.',
        variables: ['newRole']
    },
    
    // Status Updates - Generic
    homeworkStatusUpdate: {
        id: 'status_update',
        name: 'Homework Status Update',
        description: 'Sent when homework status changes',
        template: 'Homework #{homeworkId} status updated to "{status}".',
        variables: ['homeworkId', 'status']
    },
    
    // Status Updates - Specific
    homeworkInProgress: {
        id: 'homework_in_progress',
        name: 'Homework In Progress',
        description: 'Sent when homework is marked as in progress',
        template: 'Homework #{homeworkId} is now in progress.',
        variables: ['homeworkId']
    },
    workerAssignment: {
        id: 'worker_assignment',
        name: 'Worker Assignment',
        description: 'Sent when a worker is assigned to homework',
        template: 'You have been assigned homework #{homeworkId}.',
        variables: ['homeworkId']
    },
    finalPaymentApproval: {
        id: 'final_payment_approval',
        name: 'Final Payment Approval',
        description: 'Sent when homework requires final payment approval',
        template: 'Homework #{homeworkId} requires final payment approval.',
        variables: ['homeworkId']
    },
    finalReview: {
        id: 'final_review',
        name: 'Final Review',
        description: 'Sent when homework is being reviewed for final approval',
        template: 'Your homework #{homeworkId} is being reviewed for final approval.',
        variables: ['homeworkId']
    },
    homeworkCompleted: {
        id: 'homework_completed',
        name: 'Homework Completed (Student)',
        description: 'Sent to student when homework is completed',
        template: 'Your homework #{homeworkId} has been completed and final files are ready for download.',
        variables: ['homeworkId']
    },
    homeworkCompletedAgent: {
        id: 'homework_completed_agent',
        name: 'Homework Completed (Agent)',
        description: 'Sent to agent when homework is completed',
        template: 'Homework #{homeworkId} has been completed successfully.',
        variables: ['homeworkId']
    },
    homeworkCompletedSuperAgent: {
        id: 'homework_completed_super_agent',
        name: 'Homework Completed (Super Agent)',
        description: 'Sent to super agent when homework is completed',
        template: 'Homework #{homeworkId} has been completed and finalized.',
        variables: ['homeworkId']
    },
    
    // Change Requests
    changeRequest: {
        id: 'change_request',
        name: 'Student Change Request',
        description: 'Sent when student requests changes to homework',
        template: 'Student has requested changes for homework #{homeworkId}.',
        variables: ['homeworkId']
    },
    superWorkerChangeRequest: {
        id: 'super_worker_change_request',
        name: 'Super Worker Change Request',
        description: 'Sent when super worker requests changes to homework',
        template: 'Super Worker requested change to {changeDescription} for homework #{homeworkId}.{priceInfo}',
        variables: ['homeworkId', 'changeDescription', 'priceInfo']
    },
    
    // File Operations
    fileUpload: {
        id: 'file_upload',
        name: 'File Upload Notification',
        description: 'Sent when files are uploaded in the workflow',
        template: 'Files have been uploaded for homework #{homeworkId}.',
        variables: ['homeworkId', 'fileType']
    },
    workerDraftUpload: {
        id: 'worker_draft_upload',
        name: 'Worker Draft Upload',
        description: 'Sent when worker uploads draft files',
        template: 'Worker has uploaded draft files for homework #{homeworkId}. Ready for super worker review.',
        variables: ['homeworkId']
    },
    superWorkerReviewUpload: {
        id: 'super_worker_review_upload',
        name: 'Super Worker Review Upload',
        description: 'Sent when super worker uploads reviewed files',
        template: 'Super Worker has reviewed and uploaded files for homework #{homeworkId}. Ready for final approval.',
        variables: ['homeworkId']
    },
    finalFilesReady: {
        id: 'final_files_ready',
        name: 'Final Files Ready',
        description: 'Sent when final files are ready for download',
        template: 'Your homework #{homeworkId} has been completed and final files are ready for download.',
        variables: ['homeworkId']
    },
    
    // Payment Operations
    paymentApproval: {
        id: 'payment_approval',
        name: 'Payment Approval',
        description: 'Sent when homework requires payment approval',
        template: 'Homework #{homeworkId} requires final payment approval.',
        variables: ['homeworkId']
    },
    
    // Legacy - keep for backward compatibility
    completed: {
        id: 'completed',
        name: 'Homework Completed',
        description: 'Sent when homework is completed',
        template: 'Your homework #{homeworkId} has been completed and final files are ready for download.',
        variables: ['homeworkId']
    },
    homeworkSubmitted: {
        id: 'homework_submitted',
        name: 'Homework Submitted',
        description: 'Sent to student when homework is successfully submitted with payment details',
        template: 'Your homework has been submitted successfully! Reference Code: {referenceCode}. Payment Amount: ${paymentAmount}. Please transfer the payment to: {bankDetails}. Your homework will begin processing once payment is confirmed.',
        variables: ['referenceCode', 'paymentAmount', 'bankDetails']
    }
};

export async function getNotificationTemplates(): Promise<NotificationTemplates> {
    const client = await pool.connect();
    try {
        // First try to get custom templates from database
        const res = await client.query('SELECT * FROM notification_templates ORDER BY template_id');
        
        if (res.rows.length === 0) {
            // If no custom templates exist, return defaults
            return defaultTemplates;
        }
        
        // Convert database rows to NotificationTemplates object
        const templates = { ...defaultTemplates };
        res.rows.forEach(row => {
            const templateKey = Object.keys(templates).find(key => 
                templates[key as keyof NotificationTemplates].id === row.template_id
            ) as keyof NotificationTemplates;
            
            if (templateKey) {
                let variables;
                try {
                    // PostgreSQL JSONB is already parsed when retrieved
                    variables = Array.isArray(row.variables) ? row.variables : templates[templateKey].variables;
                } catch (error) {
                    console.warn(`Failed to process variables for template ${row.template_id}:`, row.variables);
                    // Use default variables from the template
                    variables = templates[templateKey].variables;
                }
                
                templates[templateKey] = {
                    id: row.template_id,
                    name: row.name,
                    description: row.description,
                    template: row.template,
                    variables: variables
                };
            }
        });
        
        return templates;
    } catch (error) {
        console.error('Error fetching notification templates:', error);
        return defaultTemplates;
    } finally {
        client.release();
    }
}

export async function saveNotificationTemplates(templates: NotificationTemplates): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Create table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS notification_templates (
                template_id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                template TEXT NOT NULL,
                variables JSONB NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Delete existing templates
        await client.query('DELETE FROM notification_templates');
        
        // Insert updated templates
        for (const [key, template] of Object.entries(templates)) {
            await client.query(
                'INSERT INTO notification_templates (template_id, name, description, template, variables) VALUES ($1, $2, $3, $4, $5)',
                [template.id, template.name, template.description, template.template, JSON.stringify(template.variables)]
            );
        }
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

// Template processing function
function processTemplate(template: string, variables: Record<string, any>): string {
    let processed = template;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        processed = processed.replace(regex, String(value));
    }
    return processed;
}

// Enhanced createNotification that uses templates
export async function createNotificationFromTemplate(
    templateId: keyof NotificationTemplates,
    variables: Record<string, any>,
    userId: string,
    homeworkId?: string
): Promise<void> {
    try {
        const templates = await getNotificationTemplates();
        const template = templates[templateId];
        
        if (!template) {
            console.error(`Template ${templateId} not found`);
            return;
        }
        
        const message = processTemplate(template.template, variables);
        await createNotification({ userId, message, homeworkId, source: 'system' });
    } catch (error) {
        console.error('Error creating notification from template:', error);
    }
}

// ========================
// MIGRATION HELPERS
// ========================

/**
 * Run the super worker fees migration
 */
export async function runSuperWorkerFeesMigration(): Promise<{ success: boolean; message: string }> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Create the super_worker_fees table
        await client.query(`
            CREATE TABLE IF NOT EXISTS super_worker_fees (
                super_worker_id VARCHAR(255) PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                fee_per_500 NUMERIC(10,2) NOT NULL DEFAULT 10.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Populate with default fees for existing super workers
        await client.query(`
            INSERT INTO super_worker_fees (super_worker_id, fee_per_500)
            SELECT id, 10.00 
            FROM users 
            WHERE role = 'super_worker' 
            AND id NOT IN (SELECT super_worker_id FROM super_worker_fees)
        `);
        
        // Add index for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_super_worker_fees_worker_id ON super_worker_fees(super_worker_id)
        `);
        
        // Create trigger function
        await client.query(`
            CREATE OR REPLACE FUNCTION create_default_super_worker_fee()
            RETURNS TRIGGER AS $$
            BEGIN
                IF NEW.role = 'super_worker' THEN
                    INSERT INTO super_worker_fees (super_worker_id, fee_per_500)
                    VALUES (NEW.id, 10.00)
                    ON CONFLICT (super_worker_id) DO NOTHING;
                END IF;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        
        // Create the trigger
        await client.query(`
            DROP TRIGGER IF EXISTS trigger_create_super_worker_fee ON users;
            CREATE TRIGGER trigger_create_super_worker_fee
                AFTER INSERT OR UPDATE ON users
                FOR EACH ROW
                EXECUTE FUNCTION create_default_super_worker_fee();
        `);
        
        // Create update timestamp trigger
        await client.query(`
            CREATE OR REPLACE FUNCTION update_super_worker_fee_timestamp()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;
        `);
        
        await client.query(`
            DROP TRIGGER IF EXISTS trigger_update_super_worker_fee_timestamp ON super_worker_fees;
            CREATE TRIGGER trigger_update_super_worker_fee_timestamp
                BEFORE UPDATE ON super_worker_fees
                FOR EACH ROW
                EXECUTE FUNCTION update_super_worker_fee_timestamp();
        `);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            message: 'Super worker fees migration completed successfully'
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', error);
        return {
            success: false,
            message: `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    } finally {
        client.release();
    }
}

// ========================
// SUPER WORKER FEE MANAGEMENT
// ========================

/**
 * Get the fee for a specific super worker
 * Falls back to global fee if no custom fee is set
 */
export async function getWorkerFee(workerId: string): Promise<number> {
    const client = await pool.connect();
    try {
        // Check if the super_worker_fees table exists
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'super_worker_fees'
            );
        `);
        
        if (tableExists.rows[0]?.exists) {
            const res = await client.query(
                'SELECT fee_per_500 FROM super_worker_fees WHERE super_worker_id = $1',
                [workerId]
            );
            
            if (res.rows.length > 0) {
                return parseFloat(res.rows[0].fee_per_500);
            }
        }
        
        // Fallback to global pricing config
        const pricingConfig = await getPricingConfig();
        return pricingConfig.fees.super_worker;
    } finally {
        client.release();
    }
}

/**
 * Check if super worker fees table exists and is functional
 */
export async function checkSuperWorkerFeesTable(): Promise<{ exists: boolean; count: number; error?: string }> {
    const client = await pool.connect();
    try {
        // Check if table exists
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'super_worker_fees'
            );
        `);
        
        if (!tableExists.rows[0]?.exists) {
            return { exists: false, count: 0 };
        }
        
        // Count records
        const countRes = await client.query('SELECT COUNT(*) as count FROM super_worker_fees');
        const count = parseInt(countRes.rows[0].count);
        
        return { exists: true, count };
        
    } catch (error) {
        return { 
            exists: false, 
            count: 0, 
            error: error instanceof Error ? error.message : 'Unknown error' 
        };
    } finally {
        client.release();
    }
}

/**
 * Get all super workers with their fees
 */
export async function fetchSuperWorkerFees(): Promise<SuperWorkerWithFee[]> {
    const client = await pool.connect();
    try {
        console.log('Starting fetchSuperWorkerFees...');
        
        // First check if the super_worker_fees table exists
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'super_worker_fees'
            );
        `);
        
        console.log('Table exists check result:', tableExists.rows[0]);
        
        if (!tableExists.rows[0]?.exists) {
            // Table doesn't exist yet, return super workers with default fees
            console.warn('super_worker_fees table does not exist yet. Returning users with default fees.');
            
            const usersRes = await client.query(`
                SELECT id, name, email, role
                FROM users 
                WHERE role = 'super_worker'
                ORDER BY name
            `);
            
            console.log('Found super workers:', usersRes.rows.length);
            
            return usersRes.rows.map(row => ({
                id: row.id,
                name: row.name,
                email: row.email,
                role: row.role,
                referenceCode: null,
                referredBy: null,
                fee_per_500: 10.00
            }));
        }
        
        console.log('Table exists, proceeding with fee query...');
        
        // Table exists, proceed with simple query
        const res = await client.query(`
            SELECT 
                u.id, 
                u.name, 
                u.email, 
                u.role,
                COALESCE(f.fee_per_500, 10.00) as fee_per_500
            FROM users u
            LEFT JOIN super_worker_fees f ON u.id = f.super_worker_id
            WHERE u.role = 'super_worker'
            ORDER BY u.name
        `);
        
        console.log('Query result:', res.rows.length, 'rows');
        
        return res.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            referenceCode: null,
            referredBy: null,
            fee_per_500: parseFloat(row.fee_per_500)
        }));
        
    } catch (error) {
        console.error('Error in fetchSuperWorkerFees:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Update a super worker's fee
 */
export async function updateSuperWorkerFee(workerId: string, fee: number): Promise<void> {
    const client = await pool.connect();
    try {
        // Check if the super_worker_fees table exists
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'super_worker_fees'
            );
        `);
        
        if (!tableExists.rows[0]?.exists) {
            throw new Error('Super worker fees table does not exist. Please run the database migration script first.');
        }
        
        await client.query(
            `INSERT INTO super_worker_fees (super_worker_id, fee_per_500) 
             VALUES ($1, $2) 
             ON CONFLICT (super_worker_id) 
             DO UPDATE SET fee_per_500 = $2, updated_at = CURRENT_TIMESTAMP`,
            [workerId, fee]
        );
    } finally {
        client.release();
    }
}

/**
 * Assign a super worker to a homework and recalculate earnings
 */
export async function assignSuperWorkerToHomework(
    homeworkId: string,
    workerId: string
): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Get the worker's fee
        const workerFee = await getWorkerFee(workerId);
        
        // Get homework details
        const hwRes = await client.query(
            'SELECT word_count, price, agent_id FROM homeworks WHERE id = $1',
            [homeworkId]
        );
        
        if (hwRes.rows.length === 0) {
            throw new Error('Homework not found');
        }
        
        const hw = hwRes.rows[0];
        
        // Get agent fee if applicable
        const pricingConfig = await getPricingConfig();
        const agentFee = pricingConfig.fees.agent;
        const agentPay = hw.agent_id ? (agentFee * (hw.word_count / 500)) : 0;
        
        // Calculate new earnings
        const superWorkerPay = workerFee * (hw.word_count / 500);
        const profit = hw.price - agentPay - superWorkerPay;
        
        const earnings = {
            total: hw.price,
            agent: agentPay > 0 ? agentPay : undefined,
            super_worker: superWorkerPay,
            profit: profit
        };
        
        // Update homework with assigned worker, new earnings, and status
        await client.query(
            `UPDATE homeworks 
             SET super_worker_id = $1, earnings = $2, status = 'assigned_to_super_worker', updated_at = CURRENT_TIMESTAMP 
             WHERE id = $3`,
            [workerId, JSON.stringify(earnings), homeworkId]
        );
        
        await client.query('COMMIT');
        
        // Send notification to assigned worker
        try {
            await createNotificationFromTemplate(
                'workerAssignment',
                { homeworkId },
                workerId,
                homeworkId
            );
        } catch (notificationError) {
            console.error('Failed to send worker assignment notification:', notificationError);
        }
        
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get all super workers for assignment dropdown
 */
export async function fetchSuperWorkersForAssignment(): Promise<User[]> {
    const client = await pool.connect();
    try {
        const res = await client.query(`
            SELECT id, name, email, role
            FROM users 
            WHERE role = 'super_worker'
            ORDER BY name
        `);
        
        return res.rows.map(row => ({
            id: row.id,
            name: row.name,
            email: row.email,
            role: row.role,
            referenceCode: null,
            referredBy: null
        }));
    } finally {
        client.release();
    }
}

export async function approveDraftFiles(homeworkId: string, approvedBy: string): Promise<void> {
    console.log('approveDraftFiles called with:', { homeworkId, approvedBy });
    
    if (!homeworkId || !approvedBy) {
        throw new Error('Missing required parameters: homeworkId and approvedBy');
    }
    
    let studentId: string; // Declare at function scope
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        console.log('Database transaction started');
        
        // Get the homework
        const homeworkRes = await client.query(
            'SELECT * FROM homeworks WHERE id = $1',
            [homeworkId]
        );
        
        if (homeworkRes.rows.length === 0) {
            throw new Error(`Homework not found with id: ${homeworkId}`);
        }
        
        const homework = homeworkRes.rows[0];
        studentId = homework.student_id; // Store for later use outside transaction
        console.log('Found homework:', { id: homework.id, status: homework.status });
        
        if (homework.status !== 'worker_draft') {
            throw new Error(`Homework is not in worker_draft status. Current status: ${homework.status}`);
        }
        
        // Check if there are draft files to approve
        const draftFilesRes = await client.query(
            'SELECT * FROM homework_files WHERE homework_id = $1 AND file_type = $2',
            [homeworkId, 'worker_draft']
        );
        
        if (draftFilesRes.rows.length === 0) {
            throw new Error('No draft files to approve');
        }
        
        console.log(`Found ${draftFilesRes.rows.length} draft files to approve`);
        
        // Check if super worker uploaded any final files
        const finalFilesRes = await client.query(
            'SELECT * FROM homework_files WHERE homework_id = $1 AND file_type = $2',
            [homeworkId, 'super_worker_review']
        );
        
        // If no super worker review files exist, convert draft files to final approved files
        if (finalFilesRes.rows.length === 0) {
            console.log('No super worker review files found, converting draft files to final approved');
            await client.query(
                'UPDATE homework_files SET file_type = $1 WHERE homework_id = $2 AND file_type = $3',
                ['final_approved', homeworkId, 'worker_draft']
            );
        } else {
            console.log(`Found ${finalFilesRes.rows.length} super worker review files`);
        }
        
        // Update homework status
        console.log('Updating homework status to final_payment_approval');
        await client.query(
            'UPDATE homeworks SET status = $1, updated_at = NOW() WHERE id = $2',
            ['final_payment_approval', homeworkId]
        );
        
        await client.query('COMMIT');
        console.log('Transaction committed successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error approving draft files:', error);
        throw error;
    } finally {
        client.release();
    }
    
    // Send notifications outside the transaction to avoid connection issues
    try {
        console.log('Sending notifications');
        
        // Notify student
         await createNotificationFromTemplate(
             'superWorkerReviewUpload',
             { homeworkId },
             studentId,
             homeworkId
         );
        
        // Notify super agents
        const client2 = await pool.connect();
        try {
            const superAgentRes = await client2.query(
                'SELECT id FROM users WHERE role = $1',
                ['super_agent']
            );
            
            for (const superAgent of superAgentRes.rows) {
                await createNotificationFromTemplate(
                    'finalPaymentApproval',
                    { homeworkId },
                    superAgent.id,
                    homeworkId
                );
            }
        } finally {
            client2.release();
        }
        
        console.log('Notifications sent successfully');
     } catch (notificationError) {
         console.error('Failed to send notifications (non-critical):', notificationError);
         // Don't throw here as the main operation succeeded
     }
}
