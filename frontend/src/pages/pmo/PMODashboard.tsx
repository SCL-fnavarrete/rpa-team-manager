import { displayLabel } from '@/utils/displayLabels';
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Progress,
  Tag,
  Timeline,
  Space,
  Button,
  Modal,
  Form,
  Input,
  Select,
  DatePicker,
  message,
  Tabs,
  Divider,
  Alert,
  Typography,
  Upload,
  Drawer,
  Checkbox
} from 'antd';
import {
  ProjectOutlined,
  AlertOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  TeamOutlined,
  RiseOutlined,
  PlusOutlined,
  BarChartOutlined,
  WarningOutlined,
  TrophyOutlined,
  CalendarOutlined,
  FireOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  EditOutlined,
  DeleteOutlined,
  ImportOutlined,
  CodeOutlined,
  FileTextOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';
import apiService from '@/services/api';
import dayjs from 'dayjs';
import { useBatchDeletion } from '../../hooks/useBatchDeletion';
import { useGanttData } from '../../hooks/useGanttData';
import { LoadingState } from '@/components/common';
import { PMORoleHeader } from '@/components/pmo/PMORoleHeader';
import { PMOGeneralManagerView } from '@/components/pmo/views/PMOGeneralManagerView';
import { PMOCommercialView } from '@/components/pmo/views/PMOCommercialView';
import { PMOControllerView } from '@/components/pmo/views/PMOControllerView';
import { PMORolePerspective, PMOExecutiveSuiteResponse } from '@/types/pmo';

const { Title, Text } = Typography;
const { TabPane } = Tabs;

interface PMODashboardData {
  projects: any[];
  overallMetrics: any;
  upcomingMilestones: any[];
  teamWorkload: any[];
  teamCapacity?: any[];
}

interface PMOAnalytics {
  executiveSummary: {
    total_projects: number;
    active_projects: number;
    completed_projects: number;
    critical_projects: number;
    over_budget_projects?: number;
    delayed_projects: number;
    avg_completion: number;
    avg_satisfaction: number;
    // Presupuesto y costos solo los envía el backend a team_lead
    total_planned_budget?: number;
    total_actual_cost?: number;
    overall_budget_variance?: number;
  };
  trendAnalysis: any[];
  budgetAnalysis?: any[];
  scheduleAnalysis: any[];
  riskAnalysis: any[];
  teamAnalysis: any[];
  qualityMetrics: any[];
  resourceUtilization: any[];
  satisfactionTrends: any[];
  riskDistribution: any[];
}

interface PMODashboardProps {
  ganttMode?: boolean;
}

export const PMODashboard: React.FC<PMODashboardProps> = ({ ganttMode = false }) => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const { id: projectIdParam } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [dashboardData, setDashboardData] = useState<PMODashboardData | null>(null);
  const [analytics, setAnalytics] = useState<PMOAnalytics | null>(null);
  const [milestoneModalVisible, setMilestoneModalVisible] = useState(false);
  const [milestoneForm] = Form.useForm();
  const [teamCapacityData, setTeamCapacityData] = useState<{ data: any[]; summary: any } | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  
  // Use the enhanced Gantt data hook for better state management
  const { ganttData, ganttLoading, error: ganttError, loadGanttData, clearError: clearGanttError, setGanttData } = useGanttData(selectedProjectId);
  const [editingItem, setEditingItem] = useState<any>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [taskModalVisible, setTaskModalVisible] = useState(false);
  const [taskForm] = Form.useForm();
  const [activeTab, setActiveTab] = useState(ganttMode ? 'gantt' : 'overview');
  const [projectFilter, setProjectFilter] = useState('');
  const [healthFilter, setHealthFilter] = useState<string | undefined>();
  const [clientFilter, setClientFilter] = useState<string | undefined>();
  const [stageFilter, setStageFilter] = useState<string | undefined>();
  const [mermaidDrawerVisible, setMermaidDrawerVisible] = useState(false);
  const [mermaidCode, setMermaidCode] = useState('');

  // PMO Executive Suite perspective state
  const [currentPerspective, setCurrentPerspective] = useState<PMORolePerspective>(() => {
    if (ganttMode) return 'operations';
    if (user?.role === 'billing') return 'controller';
    const saved = localStorage.getItem('pmo_preferred_perspective') as PMORolePerspective | null;
    return saved || 'general_manager';
  });
  const [executiveData, setExecutiveData] = useState<PMOExecutiveSuiteResponse | null>(null);
  const [executiveLoading, setExecutiveLoading] = useState(false);

  const handlePerspectiveChange = (perspective: PMORolePerspective) => {
    setCurrentPerspective(perspective);
    try {
      localStorage.setItem('pmo_preferred_perspective', perspective);
    } catch {}
  };

  const loadExecutiveData = async () => {
    try {
      setExecutiveLoading(true);
      const data = await apiService.getPMOExecutiveSuite();
      setExecutiveData(data);
    } catch (error) {
      console.error('Error loading PMO executive suite:', error);
    } finally {
      setExecutiveLoading(false);
    }
  };

  
  // Multi-selection state for batch deletion
  const [selectedItems, setSelectedItems] = useState<Set<number>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  
  // Refs to prevent multiple simultaneous API calls
  const loadingDashboard = useRef(false);
  const deletingItems = useRef(new Set<number>()); // Track items being deleted
  const totalPlannedBudget = dashboardData?.overallMetrics?.total_planned_budget;

  // Helper function to safely validate ganttData structure
  const isValidGanttData = (data: any): boolean => {
    return data && typeof data === 'object' && (Array.isArray(data.milestones) || Array.isArray(data.tasks));
  };

  // Parse Mermaid code and extract tasks/milestones
  const parseMermaidCode = (mermaidCode: string) => {
    const lines = mermaidCode.split('\n').map(line => line.trim()).filter(line => line);
    const tasks: any[] = [];
    const milestones: any[] = [];
    const taskRegistry = new Map(); // Para resolver dependencias "after"
    
    // Helper function to parse date or calculate from dependencies
    const parseDate = (dateStr: string, _taskId?: string): string | null => {
      if (!dateStr) return null;
      
      // Direct date format YYYY-MM-DD
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        return dateStr;
      }
      
      // Handle "after taskId" dependencies
      if (dateStr.startsWith('after ')) {
        const refTaskId = dateStr.replace('after ', '').trim();
        const refTask = taskRegistry.get(refTaskId);
        if (refTask && refTask.endDate) {
          return dayjs(refTask.endDate).add(1, 'day').format('YYYY-MM-DD');
        }
        // Fallback si no encuentra la referencia
        return dayjs().add(1, 'day').format('YYYY-MM-DD');
      }
      
      return null;
    };

    // Helper function to calculate end date from start date and duration
    const calculateEndDate = (startDate: string, duration: string): string => {
      if (!duration || duration === '0d') return startDate;
      
      const days = parseInt(duration.replace(/\D/g, '')) || 1;
      return dayjs(startDate).add(days - 1, 'day').format('YYYY-MM-DD');
    };
    
    for (const line of lines) {
      // Skip header lines and configuration
      if (line.startsWith('gantt') || line.startsWith('title') || 
          line.startsWith('dateFormat') || line.startsWith('axisFormat') ||
          line.startsWith('excludes') || !line) {
        continue;
      }
      
      // Parse section headers as milestones
      if (line.startsWith('section ')) {
        const sectionName = line.replace('section ', '').trim();
        const milestoneDate = dayjs().add(milestones.length * 14, 'days').format('YYYY-MM-DD');
        
        milestones.push({
          name: sectionName,
          description: `Hito de sección generado desde diagrama Mermaid: ${sectionName}`,
          milestone_type: 'delivery',
          priority: 'medium',
          impact_on_timeline: 'medium',
          planned_date: milestoneDate,
          end_date: milestoneDate
        });
        continue;
      }
      
      // Parse task/milestone lines in Mermaid format
      // Format: "Task name :status, task-id, start-date, duration"
      const lineMatch = line.match(/([^:]+)\s*:\s*([^,]*),?\s*([^,]*),?\s*([^,]*),?\s*([^,]*)/);
      if (lineMatch) {
        const [, taskName, status, taskId, startParam, durationParam] = lineMatch.map(s => s?.trim() || '');
        
        // Determine if it's a milestone
        const isMilestone = status === 'milestone' || durationParam === '0d';
        
        // Calculate dates
        const startDate = parseDate(startParam, taskId) || dayjs().format('YYYY-MM-DD');
        const duration = durationParam || (isMilestone ? '0d' : '5d');
        const endDate = calculateEndDate(startDate, duration);
        
        // Register task for dependency resolution
        taskRegistry.set(taskId, {
          name: taskName.trim(),
          startDate,
          endDate,
          isMilestone
        });
        
        if (isMilestone) {
          milestones.push({
            name: taskName.trim(),
            description: `Hito generado desde diagrama Mermaid`,
            milestone_type: 'delivery',
            priority: status === 'crit' ? 'high' : 'medium',
            impact_on_timeline: 'high',
            planned_date: startDate,
            end_date: endDate
          });
        } else {
          tasks.push({
            title: taskName.trim(),
            description: `Tarea generada desde diagrama Mermaid`,
            task_type: 'feature',
            priority: status === 'crit' ? 'high' : 'medium',
            status: status === 'done' ? 'completed' : 'pending',
            start_date: startDate,
            due_date: endDate,
            estimated_hours: parseInt(duration.replace(/\D/g, '')) * 8 || 40
          });
        }
      }
    }
    
    return { tasks, milestones };
  };

  // Import Mermaid data
  const handleMermaidImport = async () => {
    if (!mermaidCode.trim()) {
      message.warning('Por favor ingresa código Mermaid válido');
      return;
    }
    
    if (!selectedProjectId) {
      message.error('Por favor selecciona un proyecto antes de importar');
      return;
    }
    
    // Show loading modal with progress
    const hideLoading = message.loading('Analizando código Mermaid...', 0);
    let currentLoading: any = null;

    try {
      const { tasks, milestones } = parseMermaidCode(mermaidCode);

      if (tasks.length === 0 && milestones.length === 0) {
        hideLoading();
        message.warning('No se encontraron tareas ni hitos válidos en el código Mermaid');
        return;
      }

      const totalItems = tasks.length + milestones.length;
      let completedItems = 0;

      // Helper function to update progress
      const updateProgress = (progressMessage: string) => {
        // Clean up previous loading message
        if (currentLoading) {
          currentLoading();
        }
        const progress = Math.round((completedItems / totalItems) * 100);
        currentLoading = message.loading(`${progressMessage} (${progress}%)`, 0);
      };
      
      // Create milestones in parallel for better performance
      let createdMilestones = 0;
      if (milestones.length > 0) {
        updateProgress(`Creando ${milestones.length} hitos...`);
        
        // Process milestones in batches of 5 for better performance
        const milestoneBatches = [];
        for (let i = 0; i < milestones.length; i += 5) {
          milestoneBatches.push(milestones.slice(i, i + 5));
        }
        
        for (const batch of milestoneBatches) {
          const milestonePromises = batch.map(async (milestone) => {
            const milestoneData = {
              ...milestone,
              project_id: selectedProjectId,
              responsible_user_id: user?.id,
              planned_date: milestone.planned_date || dayjs().add(30, 'days').format('YYYY-MM-DD')
            };
            console.log('Creating milestone with dates:', milestoneData);
            return apiService.createMilestone(milestoneData);
          });

          try {
            await Promise.all(milestonePromises);
            createdMilestones += batch.length;
            completedItems += batch.length;
            updateProgress(`Creando hitos... (${createdMilestones}/${milestones.length})`);
          } catch (error) {
            console.error('Error creating milestone batch:', error);
          }
        }
      }
      
      // Get project board info once for all tasks (optimization)
      updateProgress('Obteniendo información del tablero...');
      let boardId = null;
      let columnId = null;
      try {
        console.log('Getting boards for project:', selectedProjectId);
        const boards = await apiService.getTaskBoards(selectedProjectId);
        console.log('Boards found:', boards);
        
        if (boards.length > 0) {
          boardId = boards[0].id;
          console.log('Using board ID:', boardId);
          
          // Get board details to find a default column
          const boardData = await apiService.getTaskBoard(boardId);
          console.log('Board data:', boardData);
          
          // Use "To Do" column or first available column
          const todoColumn = boardData.columns.find((col: any) => col.name === "Pendiente");
          columnId = todoColumn ? todoColumn.id : boardData.columns[0]?.id;
          console.log('Using column ID:', columnId);
        } else {
          console.warn('No boards found for project');
          console.log('Creating default board for Mermaid import...');
          
          // Create default board for this project
          try {
            const projectName = projects.find(p => p.id === selectedProjectId)?.name || "Proyecto";
            const newBoard = await apiService.createTaskBoard({
              project_id: selectedProjectId,
              name: `Tablero de ${projectName}`,
              description: `Tablero principal de ${projectName}`,
              board_type: 'kanban'
            });
            
            console.log('Created new board:', newBoard);
            boardId = newBoard.id;
            
            // Get the newly created board with its columns
            const boardData = await apiService.getTaskBoard(boardId);
            console.log('New board data:', boardData);
            
            // Use "To Do" column or first available column
            const todoColumn = boardData.columns.find((col: any) => col.name === "Pendiente");
            columnId = todoColumn ? todoColumn.id : boardData.columns[0]?.id;
            console.log('Using column ID from new board:', columnId);
            
            message.success('Tablero creado automáticamente para importación Mermaid');
          } catch (createError) {
            console.error('Error creating default board:', createError);
            message.error('Error al crear tablero por defecto');
          }
        }
      } catch (error) {
        console.error('Error getting board info:', error);
      }

      // Create tasks using optimized batch operations
      let createdTasks = 0;
      if (!boardId || !columnId) {
        console.error('Cannot create tasks: missing boardId or columnId', { boardId, columnId });
        message.warning('No se pudieron crear las tareas: falta información del tablero');
        completedItems += tasks.length; // Mark as completed for progress
      } else if (tasks.length > 0) {
        updateProgress(`Creando ${tasks.length} tareas...`);
        
        try {
          console.log(`📦 Creating ${tasks.length} tasks in batch...`);
          const tasksData = tasks.map(task => ({
            ...task,
            project_id: selectedProjectId,
            board_id: boardId,
            column_id: columnId,
            assignee_id: user?.id,
            // Use dates from Mermaid parsing, fallback to defaults if not provided
            start_date: task.start_date || dayjs().format('YYYY-MM-DD'),
            due_date: task.due_date || dayjs().add(14, 'days').format('YYYY-MM-DD')
          }));
          
          console.log('Creating tasks with dates:', tasksData);
          
          // If batch operation exists, use it, otherwise fall back to parallel individual calls
          if (apiService.batchCreateTasks) {
            const batchResult = await apiService.batchCreateTasks(tasksData, boardId);
            createdTasks = batchResult.createdCount || 0;
          } else {
            // Fallback: Process in parallel batches of 10
            const taskBatches = [];
            for (let i = 0; i < tasksData.length; i += 10) {
              taskBatches.push(tasksData.slice(i, i + 10));
            }
            
            for (const batch of taskBatches) {
              const taskPromises = batch.map(taskData => apiService.createTask(taskData));
              await Promise.all(taskPromises);
              createdTasks += batch.length;
              completedItems += batch.length;
              updateProgress(`Creando tareas... (${createdTasks}/${tasks.length})`);
            }
          }
          
          completedItems += tasks.length;
          console.log(`✅ Task creation completed: ${createdTasks} tasks created`);
        } catch (error) {
          console.error('Error creating tasks:', error);
          message.warning('Algunas tareas no pudieron ser creadas');
          completedItems += tasks.length; // Mark as completed for progress
        }
      }
      
      // Hide loading and show completion
      if (currentLoading) {
        currentLoading();
      }
      hideLoading();
      message.success(`Importación completada: ${createdTasks} tareas y ${createdMilestones} hitos creados`);
      setMermaidDrawerVisible(false);
      setMermaidCode('');
      
      // Reload data with a slight delay to ensure backend processes the data
      setTimeout(async () => {
        try {
          console.log('🔄 Reloading data after Mermaid import...');
          await loadDashboardData();
          if (selectedProjectId) {
            await loadGanttData(selectedProjectId, true);
          }
          console.log('✅ Data reload after Mermaid import completed successfully');
        } catch (error) {
          console.error('❌ Error reloading data after Mermaid import:', error);
          // Ensure loading states are cleared even if reload fails
          setLoading(false);
          loadingDashboard.current = false;
          message.warning('Los datos se importaron correctamente, pero hubo un problema al actualizar la vista. Recarga la página si es necesario.');
        }
      }, 500);
      
      // Safety timeout to ensure loading state doesn't get stuck
      setTimeout(() => {
        if (loading || loadingDashboard.current) {
          console.warn('⚠️ Loading state timeout after Mermaid import - forcing recovery');
          setLoading(false);
          loadingDashboard.current = false;
        }
      }, 10000); // 10 second timeout
      
    } catch (error) {
      console.error('Error importing Mermaid:', error);
      if (currentLoading) {
        currentLoading();
      }
      hideLoading();
      message.error('Error al importar el diagrama Mermaid');
    }
  };

  // Load initial data always on mount - no dependencies
  useEffect(() => {
    console.log('🚀 PMO Dashboard mounted - loading initial data');
    loadDashboardData();
    loadExecutiveData();
    loadAnalytics();
    loadDropdownData();
    loadTeamCapacity();
  }, []);

  // Handle gantt mode and project param separately
  useEffect(() => {
    if (ganttMode && projectIdParam) {
      const projectId = parseInt(projectIdParam, 10);
      console.log('🎯 Gantt mode with project param:', projectId);
      setSelectedProjectId(projectId);
      setActiveTab('gantt');
    } else {
      setActiveTab('overview');
    }
  }, [ganttMode, projectIdParam]);

  // Debug projects state changes
  useEffect(() => {
    console.log('📋 Projects state updated:', projects.length, 'projects available');
    console.log('📋 Projects list:', projects.map((p: any) => ({id: p.id, name: p.name})));
  }, [projects]);

  // State corruption detection and recovery watchdog
  useEffect(() => {
    console.log('🐕 State watchdog check:', {
      selectedProjectId,
      hasGanttData: !!ganttData,
      ganttLoading,
      projectsCount: projects.length,
      dashboardProjectsCount: dashboardData?.projects?.length || 0
    });

    // EMERGENCY FIX: Disable auto-recovery to prevent infinite loop
    // The auto-recovery mechanism was causing infinite loops when API returns 429 errors
    // TODO: Implement proper retry logic with backoff and circuit breaker
    /*
    // If we have a selected project but no gantt data and we're not loading, something went wrong
    if (selectedProjectId && !ganttData && !ganttLoading && projects.length > 0) {
      console.log('🚨 State corruption detected: have selectedProjectId but no ganttData');
      console.log('🔧 Attempting automatic recovery...');
      
      // Give it a moment, then try to reload
      setTimeout(() => {
        if (selectedProjectId && !ganttData && !ganttLoading) {
          console.log('🔧 Auto-recovery: Reloading gantt data');
          loadGanttData(selectedProjectId, true);
        }
      }, 1000);
    }
    */

    // If projects is empty but we should have data, try to reload
    if (projects.length === 0 && !loading && selectedProjectId) {
      console.log('🚨 Projects array is empty but we have selectedProjectId - reloading dropdown data');
      loadDropdownData();
    }
  }, [selectedProjectId, ganttData, ganttLoading, projects.length, dashboardData]);

  // Window error handler to catch unhandled JavaScript errors
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      console.error('🚨 UNHANDLED WINDOW ERROR:', event.error);
      console.error('🚨 Error details:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        stack: event.error?.stack
      });

      // If this happens during editing, try to recover
      if (editModalVisible || editingItem) {
        console.log('🚨 Error during editing - attempting to recover modal state');
        setEditModalVisible(false);
        setEditingItem(null);
        editForm.resetFields();
        message.error('Error detectado - modal cerrado por seguridad');
      }

      // Don't let the error propagate and break React
      event.preventDefault();
      return false;
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('🚨 UNHANDLED PROMISE REJECTION:', event.reason);
      console.error('🚨 Rejection details:', event);
      
      // Try to handle common promise rejections gracefully
      if (event.reason?.response?.status === 401) {
        message.error('Sesión expirada - por favor inicia sesión nuevamente');
      } else if (event.reason?.message) {
        message.error(`Error de conexión: ${event.reason.message}`);
      }

      // Prevent the unhandled rejection from crashing the app
      event.preventDefault();
      return false;
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [editModalVisible, editingItem]);

  const loadDashboardData = async () => {
    if (loadingDashboard.current) return;
    
    try {
      loadingDashboard.current = true;
      setLoading(true);
      console.log('📈 Loading PMO dashboard data...');
      const data = await apiService.getPMODashboard();
      console.log('✅ Dashboard data loaded:', {
        projects: data?.projects?.length || 0,
        hasOverallMetrics: !!data?.overallMetrics,
        upcomingMilestones: data?.upcomingMilestones?.length || 0
      });
      setDashboardData(data);
    } catch (error: any) {
      console.error('❌ Error loading PMO dashboard:', error);
      
      // Handle authentication errors specifically
      if (error.response?.status === 401) {
        console.log('🔴 PMODashboard: Authentication error detected, user will be redirected to login');
        message.error('Su sesión ha expirado. Será redirigido al login...');
        return; // Don't show additional error message as user will be redirected
      }
      
      const errorMessage = error.response?.data?.error || error.message || 'Error al cargar el dashboard PMO';
      message.error(errorMessage);
    } finally {
      setLoading(false);
      loadingDashboard.current = false;
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await apiService.getPMOAnalytics();
      setAnalytics(data);
    } catch (error: any) {
      console.error('Error loading PMO analytics:', error);
      // Solo mostrar error si es crítico, analytics es opcional
    }
  };

  const loadDropdownData = async () => {
    try {
      console.log('📊 Loading dropdown data (users and projects)...');
      const [usersData, projectsData] = await Promise.all([
        apiService.getUsers(),
        apiService.getProjects()
      ]);
      console.log('👥 Users loaded:', usersData?.length || 0);
      console.log('📋 Projects loaded:', projectsData?.length || 0, projectsData?.map((p: any) => ({id: p.id, name: p.name})));
      setUsers(usersData);
      setProjects(projectsData);
    } catch (error) {
      console.error('❌ Error loading dropdown data:', error);
      message.error('Error cargando datos básicos del dashboard');
    }
  };

  const loadTeamCapacity = async () => {
    try {
      setCapacityLoading(true);
      const res = await apiService.getTeamCapacity();
      setTeamCapacityData(res);
    } catch (error) {
      console.error('❌ Error loading team capacity:', error);
    } finally {
      setCapacityLoading(false);
    }
  };

  const handleCreateMilestone = async (values: any) => {
    try {
      await apiService.createMilestone({
        ...values,
        planned_date: values.planned_date.format('YYYY-MM-DD'),
        end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : values.planned_date.format('YYYY-MM-DD'),
        actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : null
      });
      message.success('Hito creado exitosamente');
      setMilestoneModalVisible(false);
      milestoneForm.resetFields();
      loadDashboardData();
      // Reload gantt data if we're in gantt view
      if (selectedProjectId) {
        loadGanttData(selectedProjectId, true);
      }
    } catch (error) {
      console.error('Error creating milestone:', error);
      message.error('Error al crear el hito');
    }
  };

  const handleCreateTask = async (values: any) => {
    try {
      if (!selectedProjectId) {
        message.warning('Selecciona un proyecto antes de crear una tarea');
        return;
      }
      const startStr = values.start_date ? values.start_date.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
      const dueStr = values.due_date ? values.due_date.format('YYYY-MM-DD') : startStr;

      const boards = await apiService.getTaskBoards(selectedProjectId).catch(() => []);
      if (Array.isArray(boards) && boards.length > 0) {
        const boardDetail = await apiService.getTaskBoard(boards[0].id);
        const firstColumnId = boardDetail?.columns?.[0]?.id;
        if (firstColumnId) {
          await apiService.createTask({
            board_id: boardDetail.id,
            column_id: firstColumnId,
            title: values.title,
            description: values.description,
            task_type: 'task',
            status: values.status || 'todo',
            priority: values.priority || 'medium',
            assignee_ids: Array.isArray(values.assignee_ids) ? values.assignee_ids : [],
            estimated_hours: values.estimated_hours ? Number(values.estimated_hours) : undefined,
            start_date: startStr,
            due_date: dueStr
          });
        } else {
          await apiService.createMilestone({
            project_id: selectedProjectId,
            name: values.title,
            description: values.description,
            planned_date: startStr,
            end_date: dueStr,
            priority: values.priority || 'medium',
            responsible_user_id: Array.isArray(values.assignee_ids) ? values.assignee_ids[0] : undefined
          });
        }
      } else {
        await apiService.createMilestone({
          project_id: selectedProjectId,
          name: values.title,
          description: values.description,
          planned_date: startStr,
          end_date: dueStr,
          priority: values.priority || 'medium',
          responsible_user_id: Array.isArray(values.assignee_ids) ? values.assignee_ids[0] : undefined
        });
      }

      message.success(`Nueva tarea creada: ${values.title}`);
      setTaskModalVisible(false);
      taskForm.resetFields();
      loadDashboardData();
      if (selectedProjectId) {
        loadGanttData(selectedProjectId, true);
      }
    } catch (error) {
      console.error('Error creating task:', error);
      message.error('Error al crear la tarea');
    }
  };

  // The loadGanttData function is now provided by the useGanttData hook

  // Use the custom hook for batch deletion operations
  const { isDeleting: batchDeleting, handleBatchDelete } = useBatchDeletion({
    ganttData,
    selectedItems,
    onSuccess: () => {
      // Clear selection and exit selection mode
      setSelectedItems(new Set());
      setIsSelectionMode(false);
    },
    onLoadGanttData: (projectId) => loadGanttData(projectId, true), // Force reload after deletion
    selectedProjectId: selectedProjectId ?? undefined
  });

  useEffect(() => {
    console.log('selectedProjectId changed to:', selectedProjectId);
    if (selectedProjectId) {
      console.log('Loading Gantt data for selected project:', selectedProjectId);
      loadGanttData(selectedProjectId);
    }
    // The useGanttData hook automatically handles clearing data when selectedProjectId changes
  }, [selectedProjectId, loadGanttData]);

  // useEffect to pre-fill milestone form when modal opens and project is selected
  useEffect(() => {
    if (milestoneModalVisible && selectedProjectId) {
      console.log('🎯 Pre-filling milestone form with selectedProjectId:', selectedProjectId);
      milestoneForm.setFieldsValue({
        project_id: selectedProjectId
      });
    } else if (milestoneModalVisible && !selectedProjectId) {
      // Clear form when modal opens without selected project
      milestoneForm.resetFields();
    }
  }, [milestoneModalVisible, selectedProjectId, milestoneForm]);

  const handleEditItem = (record: any) => {
    setEditingItem(record);
    console.log('🔍 Setting form values for edit:', {
      type: record.type,
      planned_date: record.planned_date,
      actual_date: record.actual_date,
      start_date: record.start_date,
      due_date: record.due_date
    });
    
    editForm.setFieldsValue({
      ...record,
      planned_date: record.planned_date ? dayjs(record.planned_date) : null,
      end_date: record.end_date ? dayjs(record.end_date) : null,
      actual_date: record.actual_date ? dayjs(record.actual_date) : null,
      start_date: record.start_date ? dayjs(record.start_date) : null,
      due_date: record.due_date ? dayjs(record.due_date) : null,
      assignee_ids: record.assignee_ids
        ? record.assignee_ids.split('||').map(Number)
        : (record.assignee_id ? [record.assignee_id] : [])
    });
    setEditModalVisible(true);
  };

  const handleDeleteItem = async (record: any) => {
    // Prevent deleting the same item multiple times
    if (deletingItems.current.has(record.id)) {
      console.log('⚠️ Item already being deleted, skipping:', record.id);
      message.warning('Este elemento ya se está eliminando');
      return;
    }

    Modal.confirm({
      title: `¿Eliminar ${record.type === 'milestone' ? 'hito' : 'tarea'}?`,
      content: `¿Estás seguro de que quieres eliminar "${record.name || record.title}"?`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        // Mark item as being deleted immediately
        deletingItems.current.add(record.id);
        console.log(`🗑️ Starting deletion of ${record.type}:`, record.id, record.name || record.title);
        
        // Optimistically update UI to prevent visual inconsistency
        if (isValidGanttData(ganttData)) {
          const optimisticData = {
            ...ganttData,
            milestones: (ganttData.milestones || []).filter((item: any) => item.id !== record.id),
            tasks: (ganttData.tasks || []).filter((item: any) => item.id !== record.id)
          };
          setGanttData(optimisticData);
          console.log('✨ Optimistically removed item from UI');
        } else {
          console.warn('⚠️ Cannot perform optimistic update: invalid ganttData structure', ganttData);
        }
        
        try {
          // Perform deletion with timeout to prevent hanging requests
          const deletePromise = record.type === 'milestone' 
            ? apiService.deleteMilestone(record.id)
            : apiService.deleteTask(record.id);
          
          // Add 10 second timeout for deletion requests
          await Promise.race([
            deletePromise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('Deletion timeout after 10 seconds')), 10000)
            )
          ]);
          
          message.success(`${record.type === 'milestone' ? 'Hito' : 'Tarea'} "${record.name || record.title}" eliminado exitosamente`);
          console.log(`✅ ${record.type} deleted successfully:`, record.id);
          
          // Confirm deletion with fresh data after a short delay
          setTimeout(() => {
            if (selectedProjectId && !ganttLoading) {
              console.log('🔄 Refreshing data after successful deletion');
              loadGanttData(selectedProjectId, true);
            }
          }, 500);
          
        } catch (error: any) {
          console.error('❌ DELETION FAILED:', {
            itemType: record.type,
            itemId: record.id,
            itemName: record.name || record.title,
            error: error.message,
            status: error.response?.status,
            response: error.response?.data,
            errorCode: error.response?.data?.code
          });
          
          // Handle specific error cases with improved error codes
          let errorMessage = 'Error desconocido';
          let shouldShowError = true;
          const errorCode = error.response?.data?.code;
          
          switch (error.response?.status) {
            case 404:
              if (errorCode === 'TASK_NOT_FOUND') {
                errorMessage = 'La tarea ya fue eliminada o no existe';
              } else if (errorCode === 'MILESTONE_NOT_FOUND') {
                errorMessage = 'El hito ya fue eliminado o no existe';
              } else {
                errorMessage = 'El elemento ya fue eliminado o no existe';
              }
              console.log('ℹ️ Item already deleted, continuing normally');
              shouldShowError = false; // Don't show error for already deleted items
              break;
              
            case 409:
              if (errorCode === 'DATABASE_LOCKED') {
                errorMessage = 'Base de datos temporalmente bloqueada, intente nuevamente en unos segundos';
              } else if (errorCode === 'CONCURRENT_MODIFICATION') {
                errorMessage = 'El elemento fue modificado por otro usuario, actualizando datos...';
              } else if (errorCode === 'DEPENDENCY_CONSTRAINT') {
                errorMessage = 'No se puede eliminar: el elemento tiene dependencias activas';
              } else {
                errorMessage = 'Conflicto de concurrencia, intente nuevamente';
              }
              break;
              
            case 500:
              if (errorCode === 'DATABASE_SCHEMA_ERROR') {
                errorMessage = 'Error de esquema de base de datos. Contacte al administrador.';
              } else if (errorCode === 'INTERNAL_ERROR') {
                errorMessage = 'Error interno del servidor';
              } else {
                errorMessage = 'Error interno del servidor';
              }
              break;
              
            default:
              if (error.message?.includes('timeout')) {
                errorMessage = 'Tiempo de espera agotado, verifique si la eliminación se completó';
              } else {
                errorMessage = error.message || 'Error interno del servidor';
              }
          }
          
          // Show error message based on shouldShowError flag
          if (shouldShowError) {
            message.error(`Error al eliminar ${record.type === 'milestone' ? 'hito' : 'tarea'}: ${errorMessage}`);
          }
          
          // Always reload fresh data on error to restore correct UI state
          console.log('🔄 Reloading fresh data due to deletion error');
          if (selectedProjectId) {
            // Add small delay for concurrent modification errors to allow other operations to complete
            const reloadDelay = errorCode === 'CONCURRENT_MODIFICATION' ? 1000 : 100;
            setTimeout(() => {
              loadGanttData(selectedProjectId, true);
            }, reloadDelay);
          }
          
        } finally {
          // Always remove from deletion tracking
          deletingItems.current.delete(record.id);
          console.log(`✅ Removed ${record.id} from deletion tracking`);
        }
      }
    });
  };

  // Multi-selection handlers for batch deletion
  const handleItemSelect = (id: number) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedItems(newSelected);
  };

  const handleSelectAll = () => {
    if (!isValidGanttData(ganttData)) return;
    
    const allItemIds = new Set<number>();
    
    // Add all milestone IDs
    (ganttData.milestones || []).forEach((milestone: any) => {
      if (milestone.id) allItemIds.add(milestone.id);
    });
    
    // Add all task IDs
    (ganttData.tasks || []).forEach((task: any) => {
      if (task.id) allItemIds.add(task.id);
    });
    
    setSelectedItems(allItemIds);
  };

  const handleSelectNone = () => {
    setSelectedItems(new Set());
  };

  // The handleBatchDelete function is now provided by the useBatchDeletion hook

  const handleSaveEdit = async (values: any) => {
    try {
      console.log('🔄 Starting update for:', editingItem?.type, editingItem?.id, 'with values:', values);
      
      if (editingItem.type === 'milestone') {
        const updateData = {
          ...values,
          planned_date: values.planned_date ? values.planned_date.format('YYYY-MM-DD') : null,
          end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : null,
          actual_date: values.actual_date ? values.actual_date.format('YYYY-MM-DD') : null
        };
        console.log('🎯 Updating milestone with data:', updateData);
        await apiService.updateMilestone(editingItem.id, updateData);
        message.success(`Hito actualizado: ${values.name}`);
      } else {
        // Task update - use real updateTask API
        const updateData = {
          ...values,
          start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : null,
          due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null
        };
        console.log('🎯 Updating task with data:', updateData);
        await apiService.updateTask(editingItem.id, updateData);
        message.success(`Tarea actualizada: ${values.title}`);
      }
      
      console.log('✅ Update successful, closing modal and reloading data');
      setEditModalVisible(false);
      setEditingItem(null);
      editForm.resetFields();
      
      // Reload gantt data with error protection
      if (selectedProjectId) {
        console.log('🔄 Reloading Gantt data for project:', selectedProjectId);
        await loadGanttData(selectedProjectId, true);
        console.log('✅ Gantt data reloaded successfully');
      }
    } catch (error: any) {
      console.error('❌ CRITICAL ERROR in handleSaveEdit:', error);
      console.error('❌ Error stack:', error.stack);
      console.error('❌ Error response:', error.response?.data);
      
      // Try to recover gracefully
      try {
        console.log('🚨 Attempting to recover from error...');
        // Close modal safely
        setEditModalVisible(false);
        setEditingItem(null);
        editForm.resetFields();
        
        // Try to reload dashboard data
        await loadDashboardData();
        await loadDropdownData();
        
        // If we have a selected project, try to reload its data (with safeguards)
        if (selectedProjectId && !ganttLoading) {
          console.log('🔄 Recovery: Reloading Gantt data for project:', selectedProjectId);
          // Add small delay to prevent immediate retry conflicts
          await new Promise(resolve => setTimeout(resolve, 500));
          await loadGanttData(selectedProjectId, true);
        }
        
        message.error(`Error al actualizar: ${error.message || 'Error desconocido'}`);
        console.log('✅ Recovery completed');
      } catch (recoveryError) {
        console.error('❌ RECOVERY FAILED:', recoveryError);
        // Last resort: clear everything and start fresh
        console.log('🚨 Last resort recovery: clearing state...');
        setSelectedProjectId(null);
        setGanttData(null);
        setEditModalVisible(false);
        setEditingItem(null);
        editForm.resetFields();
        
        // Clear localStorage as user mentioned this fixes the issue
        try {
          localStorage.removeItem('auth-storage');
          sessionStorage.clear();
          console.log('🧹 Local storage cleared');
        } catch (e) {
          console.error('Failed to clear localStorage:', e);
        }
        
        message.error('Error crítico: Por favor recarga la página (F5)');
      }
    }
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />;
      case 'warning': return <AlertOutlined style={{ color: 'var(--color-warning)' }} />;
      case 'critical': return <AlertOutlined style={{ color: 'var(--color-error)' }} />;
      default: return <ClockCircleOutlined style={{ color: 'var(--color-border)' }} />;
    }
  };

  const getResponsibilityIndicator = (responsibility: string) => {
    switch (responsibility) {
      case 'internal': 
        return { icon: '🏢', color: 'var(--color-info)', bg: 'var(--color-info-bg)', label: 'Interno' };
      case 'client': 
        return { icon: '👤', color: 'var(--color-warning)', bg: 'var(--color-warning-bg)', label: 'Cliente' };
      case 'external': 
        return { icon: '🏪', color: 'var(--color-error)', bg: 'var(--color-error-bg)', label: 'Externo' };
      case 'shared': 
        return { icon: '🤝', color: 'var(--color-info)', bg: 'var(--color-info-bg)', label: 'Compartido' };
      default: 
        return { icon: '🏢', color: 'var(--color-info)', bg: 'var(--color-info-bg)', label: 'Interno' };
    }
  };

  const visibleProjects = (dashboardData?.projects || []).filter((project: any) => {
    const search = `${project.name || ''} ${project.assigned_to_name || ''} ${project.client_name || ''}`.toLocaleLowerCase();
    return (!projectFilter || search.includes(projectFilter.toLocaleLowerCase())) &&
      (!healthFilter || project.project_health_status === healthFilter) &&
      (!clientFilter || String(project.client_id || '') === clientFilter) &&
      (!stageFilter || (project.commercial_stage || 'approved') === stageFilter);
  });
  const needsAttention = visibleProjects.filter((project: any) => project.project_health_status === 'critical' || project.project_health_status === 'warning' || (project.days_to_deadline !== null && project.days_to_deadline !== undefined && project.days_to_deadline < 7));
  const openProject = (id: number) => navigate(`/projects/${id}`);
  // Presupuesto y costos del análisis solo llegan para team_lead; sin ellos se omiten esas tarjetas y columnas
  const showBudgetAnalytics = Array.isArray(analytics?.budgetAnalysis);

  if (loading) {
    return <LoadingState tip="Cargando centro PMO…" minHeight={400} />;
  }

  return (
    <div style={{ padding: 'clamp(12px, 3vw, 24px)' }}>
      <PMORoleHeader
        currentPerspective={currentPerspective}
        onPerspectiveChange={handlePerspectiveChange}
        executiveData={executiveData}
        loading={executiveLoading}
        onRefresh={() => {
          loadExecutiveData();
          loadDashboardData();
        }}
      />

      {currentPerspective === 'general_manager' && (
        <PMOGeneralManagerView
          data={executiveData?.general_manager || null}
          loading={executiveLoading}
          onGoToGantt={(id) => {
            setSelectedProjectId(id);
            handlePerspectiveChange('operations');
            setActiveTab('gantt');
          }}
        />
      )}

      {currentPerspective === 'commercial' && (
        <PMOCommercialView
          data={executiveData?.commercial || null}
          loading={executiveLoading}
        />
      )}

      {currentPerspective === 'controller' && (
        <PMOControllerView
          data={executiveData?.controller || null}
          loading={executiveLoading}
        />
      )}

      {currentPerspective === 'operations' && (
        <>
          <Row justify="space-between" align="middle" style={{ marginBottom: '16px' }}>
            <Col>
              <Title level={4} style={{ margin: 0 }}>Gestión Operativa PMO</Title>
              <Text type="secondary">Portafolio, cronogramas Gantt, dependencias externas y capacidad FTE</Text>
            </Col>
            <Col>
              <Space>
                {['team_lead', 'rpa_operations'].includes(user?.role || '') && (
                  <Button
                    type="primary" 
                    icon={<PlusOutlined />}
                    onClick={() => setMilestoneModalVisible(true)}
                  >
                    Crear Hito
                  </Button>
                )}
              </Space>
            </Col>
          </Row>

      <Tabs activeKey={activeTab} onChange={setActiveTab}>
        <TabPane tab="Vista General" key="overview">
          <Card title="Requieren atención" extra={<Tag>{needsAttention.length} proyectos</Tag>} style={{ marginBottom: 16 }}>
            <Space wrap style={{ width: '100%', marginBottom: 12 }}>
              <Input allowClear aria-label="Buscar proyectos" placeholder="Proyecto, cliente o responsable" value={projectFilter} onChange={event => setProjectFilter(event.target.value)} style={{ width: 'min(100%, 320px)' }} />
              <Select allowClear aria-label="Filtrar por salud" placeholder="Todas las condiciones" value={healthFilter} onChange={setHealthFilter} style={{ minWidth: 160 }} options={[{ value: 'critical', label: 'Crítica' }, { value: 'warning', label: 'En alerta' }, { value: 'healthy', label: 'Saludable' }]} />
              <Select allowClear showSearch optionFilterProp="label" aria-label="Filtrar por cliente" placeholder="Todos los clientes" value={clientFilter} onChange={setClientFilter} style={{ minWidth: 180 }} options={Array.from(new Map((dashboardData?.projects || []).filter((p: any) => p.client_id && p.client_name).map((p: any) => [String(p.client_id), p.client_name])).entries()).map(([value, label]) => ({ value, label }))} />
              <Select allowClear aria-label="Filtrar por etapa" placeholder="Todas las etapas" value={stageFilter} onChange={setStageFilter} style={{ minWidth: 160 }} options={[{ value: 'quoting', label: 'En cotización' }, { value: 'approved', label: 'Aprobado' }, { value: 'lost', label: 'Perdido' }]} />
              <Button onClick={() => { setProjectFilter(''); setHealthFilter(undefined); setClientFilter(undefined); setStageFilter(undefined); }}>Limpiar filtros</Button>
            </Space>
            {needsAttention.length ? <Table size="small" rowKey="id" dataSource={needsAttention} pagination={{ pageSize: 6, showSizeChanger: false }} scroll={{ x: 680 }} columns={[
              { title: 'Proyecto', dataIndex: 'name', key: 'name', render: (name: string, project: any) => <Button type="link" style={{ padding: 0, height: 'auto', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => openProject(project.id)}>{name}</Button> },
              { title: 'Condición', key: 'condition', render: (_: unknown, project: any) => <Space wrap>{project.project_health_status !== 'healthy' && <Tag>{project.project_health_status === 'critical' ? 'Riesgo crítico' : 'En alerta'}</Tag>}{project.days_to_deadline < 0 ? <Tag>Retrasado {Math.abs(project.days_to_deadline)} días</Tag> : project.days_to_deadline < 7 && <Tag>{project.days_to_deadline === 0 ? 'Vence hoy' : `Vence en ${project.days_to_deadline} días`}</Tag>}{project.risk_level && <Tag>Riesgo: {({ low: 'Bajo', medium: 'Medio', high: 'Alto', critical: 'Crítico' } as Record<string, string>)[project.risk_level] || project.risk_level}</Tag>}</Space> },
              { title: 'Responsable', dataIndex: 'assigned_to_name', key: 'owner', render: (name: string) => name || 'Sin asignar' },
              { title: 'Acceso', key: 'actions', render: (_: unknown, project: any) => <Space><Button size="small" onClick={() => openProject(project.id)}>Ficha</Button><Button size="small" onClick={() => { setSelectedProjectId(project.id); setActiveTab('gantt'); }}>Cronograma</Button></Space> }
            ]} /> : <Alert type="success" showIcon message="Sin excepciones para los filtros actuales" />}
          </Card>
          {/* Resumen ejecutivo de métricas */}
          
          {/* Fila 1: KPIs Críticos */}
          <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
            <Col xs={24} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Proyectos Activos"
                  value={dashboardData?.overallMetrics?.active_projects || 0}
                  prefix={<ThunderboltOutlined style={{ color: 'var(--color-info)' }} />}
                  valueStyle={{ color: 'var(--color-info)', fontSize: '24px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  de {dashboardData?.overallMetrics?.total_projects || 0} totales
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="En Riesgo"
                  value={dashboardData?.overallMetrics?.critical_projects || 0}
                  prefix={<WarningOutlined style={{ color: 'var(--color-error)' }} />}
                  valueStyle={{ color: 'var(--color-error)', fontSize: '24px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  requieren atención
                </div>
              </Card>
            </Col>
            {user?.role === 'team_lead' && <Col xs={24} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Presupuesto Total"
                  value={totalPlannedBudget == null ? 'N/D' : Math.round(Number(totalPlannedBudget) / 1000000)}
                  suffix={totalPlannedBudget == null ? undefined : 'M'}
                  prefix={<DollarOutlined style={{ color: 'var(--color-success)' }} />}
                  valueStyle={{ color: 'var(--color-success)', fontSize: '24px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  CLP planificado
                </div>
              </Card>
            </Col>}
            <Col xs={24} sm={12} md={6}>
              <Card size="small">
                <Statistic
                  title="Progreso Global"
                  value={Math.round(dashboardData?.overallMetrics?.avg_completion || 0)}
                  suffix="%"
                  prefix={<TrophyOutlined style={{ color: 'var(--color-warning)' }} />}
                  valueStyle={{ color: 'var(--color-warning)', fontSize: '24px' }}
                />
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  completitud promedio
                </div>
              </Card>
            </Col>
          </Row>

          {/* Fila 2: Alertas Críticas y Resumen Visual */}
          <Row gutter={[16, 16]} style={{ marginBottom: '20px' }}>
            {/* Panel de Alertas Críticas */}
            <Col xs={24} lg={8}>
              <Card 
                title={<span><FireOutlined style={{ color: 'var(--color-error)' }} /> Alertas Críticas</span>} 
                size="small"
                style={{ height: '300px' }}
              >
                <div style={{ height: '240px', overflowY: 'auto' }}>
                  {needsAttention.slice(0, 8).map((project: any) => (
                      <Alert
                        key={project.id}
                        message={project.name}
                        description={
                          project.days_to_deadline === null || project.days_to_deadline === undefined
                            ? 'Sin fecha límite definida'
                            : project.days_to_deadline < 0
                              ? `Retrasado ${Math.abs(project.days_to_deadline)} días`
                              : project.days_to_deadline < 7
                                ? `Vence en ${project.days_to_deadline} días`
                                : 'Estado crítico'
                        }
                        type={
                          project.days_to_deadline === null || project.days_to_deadline === undefined
                            ? 'warning'
                            : project.days_to_deadline < 0
                              ? 'error'
                              : 'warning'
                        }
                        style={{ marginBottom: '8px', cursor: 'pointer' }}
                        onClick={() => openProject(project.id)}
                        showIcon
                      />
                    ))}
                  {needsAttention.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
                      <CheckCircleOutlined style={{ fontSize: '32px', marginBottom: '8px' }} />
                      <div>No hay alertas críticas</div>
                    </div>
                  )}
                </div>
              </Card>
            </Col>

            {/* Distribución de Estados */}
            <Col xs={24} lg={8}>
              <Card 
                title={<span><BarChartOutlined /> Distribución de Estados</span>} 
                size="small"
                style={{ height: '300px' }}
              >
                <div style={{ height: '240px', padding: '10px' }}>
                  {['healthy', 'warning', 'critical'].map(status => {
                    const count = dashboardData?.projects?.filter((p: any) => p.project_health_status === status)?.length || 0;
                    const total = dashboardData?.projects?.length || 1;
                    const percentage = Math.round((count / total) * 100);
                    
                    return (
                      <div key={status} style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                          <span style={{ 
                            color: status === 'healthy' ? 'var(--color-success)' : status === 'warning' ? 'var(--color-warning)' : 'var(--color-error)',
                            fontWeight: 'bold'
                          }}>
                            {status === 'healthy' ? '🟢 Saludables' : status === 'warning' ? '🟡 En Alerta' : '🔴 Críticos'}
                          </span>
                          <span>{count} ({percentage}%)</span>
                        </div>
                        <div style={{ 
                          background: 'var(--color-border)', 
                          borderRadius: '10px', 
                          height: '10px',
                          overflow: 'hidden'
                        }}>
                          <div style={{ 
                            width: `${percentage}%`,
                            height: '100%',
                            background: status === 'healthy' ? 'var(--color-success)' : status === 'warning' ? 'var(--color-warning)' : 'var(--color-error)',
                            borderRadius: '10px'
                          }} />
                        </div>
                      </div>
                    );
                  })}
                  
                  {/* Satisfacción Cliente */}
                  <Divider style={{ margin: '16px 0' }} />
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'var(--color-info)' }}>
                      {dashboardData?.overallMetrics?.avg_satisfaction?.toFixed(1) || 'N/A'}/10
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>Satisfacción Promedio</div>
                  </div>
                </div>
              </Card>
            </Col>

            {/* Carga de Trabajo del Equipo */}
            <Col xs={24} lg={8}>
              <Card 
                title={<span><TeamOutlined /> Carga del Equipo</span>} 
                size="small"
                style={{ height: '300px' }}
                extra={<Button type="link" size="small" onClick={() => setActiveTab('capacity')}>Ver detalle FTE</Button>}
              >
                <div style={{ height: '240px', overflowY: 'auto' }}>
                  {dashboardData?.teamCapacity?.length ? dashboardData.teamCapacity.slice(0, 6).map((member: any) => (
                    <div key={member.id} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '8px',
                      background: 'var(--color-surface-raised)',
                      borderRadius: '4px',
                      marginBottom: '6px'
                    }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                          {member.full_name}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                          {member.assigned_projects} proyectos · {Number(member.planned_fte).toFixed(2)} FTE comprometido · {Number(member.budgeted_hours || 0).toLocaleString('es-CL')} h presupuestadas
                        </div>
                      </div>
                      <div style={{
                        padding: '2px 6px',
                        borderRadius: '10px',
                        fontSize: '10px',
                        background: member.active_tasks > 8 ? 'var(--color-error-bg)' : member.active_tasks > 4 ? 'var(--color-warning-bg)' : 'var(--color-primary-bg)',
                        color: member.active_tasks > 8 ? 'var(--color-error)' : member.active_tasks > 4 ? 'var(--color-warning)' : 'var(--color-success)'
                      }}>
                        {Number(member.planned_fte).toFixed(2)} FTE
                      </div>
                    </div>
                  )) : dashboardData?.teamWorkload?.length ? dashboardData.teamWorkload.slice(0, 6).map((member: any) => (
                    <div key={member.id} style={{ padding: '8px', borderBottom: '1px solid var(--color-border)' }}>{member.full_name} · {member.active_tasks} tareas activas</div>
                  )) : (
                    <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--color-text-muted)' }}>
                      Sin datos del equipo
                    </div>
                  )}
                </div>
              </Card>
            </Col>
          </Row>

          {/* Fila 3: Tabla de Proyectos Mejorada y Timeline */}
          <Row gutter={[16, 16]}>
            {/* Tabla de proyectos mejorada */}
            <Col xs={24} lg={16}>
              <Card 
                title={<span><EyeOutlined /> Estado Detallado de Proyectos</span>} 
                extra={
                  <Space>
                    <Tag>Total: {dashboardData?.projects?.length || 0}</Tag>
                    <Button 
                      size="small" 
                      icon={<EyeOutlined />}
                      onClick={() => setActiveTab('gantt')}
                    >
                      Ver Gantt
                    </Button>
                  </Space>
                }
                size="small"
              >
                    <Table
                  dataSource={visibleProjects}
                  columns={[
                    {
                      title: 'Proyecto',
                      dataIndex: 'name',
                      key: 'name',
                      width: 200,
                      render: (text: string, record: any) => (
                        <div>
                          <Button type="link" style={{ height: 'auto', padding: 0, fontWeight: 'bold', fontSize: '12px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => openProject(record.id)}>{text}</Button>
                          <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                            {getHealthIcon(record.project_health_status)} {record.assigned_to_name || 'Sin asignar'}
                          </div>
                        </div>
                      ),
                    },
                    {
                      title: 'Avance del cronograma',
                      dataIndex: 'completion_percentage',
                      key: 'progress',
                      width: 120,
                      render: (value: number) => (
                        <Progress
                          percent={value || 0}
                          size="small"
                          strokeColor={value > 80 ? 'var(--color-success)' : value > 50 ? 'var(--color-warning)' : 'var(--color-error)'}
                        />
                      ),
                    },
                    {
                      title: "Fecha límite",
                      key: 'deadline',
                      width: 100,
                      render: (record: any) => (
                        <div style={{ fontSize: '11px' }}>
                          <div>{record.end_date ? dayjs(record.end_date).format('DD/MM/YY') : 'N/A'}</div>
                          <div style={{
                            color: record.days_to_deadline === null || record.days_to_deadline === undefined
                              ? 'var(--color-text-muted)'
                              : record.days_to_deadline < 0
                                ? 'var(--color-error)'
                                : record.days_to_deadline < 7
                                  ? 'var(--color-warning)'
                                  : 'var(--color-success)'
                          }}>
                            {record.days_to_deadline !== null
                              ? `${record.days_to_deadline < 0 ? 'Retrasado' : record.days_to_deadline === 0 ? 'Hoy' : record.days_to_deadline + 'd'}`
                              : 'N/A'
                            }
                          </div>
                        </div>
                      ),
                    },
                    ...(user?.role === 'team_lead' ? [{
                      title: 'Presupuesto',
                      key: 'budget',
                      width: 100,
                      render: (record: any) => (
                        <div style={{ fontSize: '11px' }}>
                          <div>{record.planned_budget ? `$${(record.planned_budget / 1000000).toFixed(1)}M` : 'N/A'}</div>
                          <div style={{ 
                            color: record.cost_variance_percentage > 10 ? 'var(--color-error)' : record.cost_variance_percentage > 0 ? 'var(--color-warning)' : 'var(--color-success)'
                          }}>
                            {record.cost_variance_percentage ? `${record.cost_variance_percentage > 0 ? '+' : ''}${record.cost_variance_percentage.toFixed(1)}%` : 'N/A'}
                          </div>
                        </div>
                      ),
                    }] : []),
                    {
                      title: 'Acciones',
                      key: 'actions',
                      width: 80,
                      render: (record: any) => (
                        <Button 
                          type="primary" 
                          size="small" 
                          ghost
                          onClick={() => {
                            setSelectedProjectId(record.id);
                            setActiveTab('gantt');
                          }}
                        >
                          Gantt
                        </Button>
                      ),
                    }
                  ]}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 8, showSizeChanger: false }}
                  scroll={{ y: 300 }}
                />
              </Card>
            </Col>

            {/* Hitos próximos mejorado */}
            <Col xs={24} lg={8}>
              <Card 
                title={<span><CalendarOutlined /> Cronograma de entregas</span>} 
                extra={<Tag color="blue">{dashboardData?.upcomingMilestones?.length || 0} hitos</Tag>}
                size="small"
              >
                <div style={{ height: '385px', overflowY: 'auto' }}>
                  <Timeline>
                    {dashboardData?.upcomingMilestones?.slice(0, 12).map((milestone: any) => (
                      <Timeline.Item
                        key={milestone.id}
                        color={
                          milestone.days_until < 0 ? 'red' : 
                          milestone.days_until < 3 ? 'orange' : 
                          milestone.days_until < 7 ? 'blue' : 'green'
                        }
                        dot={
                          milestone.days_until < 0 ? <WarningOutlined style={{ color: 'red' }} /> :
                          milestone.days_until < 3 ? <ClockCircleOutlined style={{ color: 'orange' }} /> :
                          undefined
                        }
                      >
                        <div>
                          <Button type="link" style={{ height: 'auto', padding: 0, fontWeight: 'bold', fontSize: '12px', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => navigate(`/pmo/gantt/${milestone.project_id}`)}>{milestone.name}</Button>
                          <div><Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/pmo/gantt/${milestone.project_id}`)}>{milestone.project_name} · Abrir cronograma</Button></div>
                          <div style={{ 
                            fontSize: '10px',
                            color: milestone.days_until < 0 ? 'var(--color-error)' : milestone.days_until < 3 ? 'var(--color-warning)' : 'var(--color-success)'
                          }}>
                            📅 {dayjs(milestone.planned_date).format('DD/MM/YYYY')} 
                            {milestone.days_until !== null && (
                              <span style={{ marginLeft: '8px' }}>
                                ({milestone.days_until < 0 ? `Retrasado ${Math.abs(milestone.days_until)}d` : 
                                  milestone.days_until === 0 ? 'HOY' : `${milestone.days_until}d`})
                              </span>
                            )}
                          </div>
                          {milestone.responsible_name && (
                            <div style={{ fontSize: '10px', color: 'var(--color-text-muted)', marginTop: '2px' }}>
                              👤 {milestone.responsible_name}
                            </div>
                          )}
                        </div>
                      </Timeline.Item>
                    ))}
                  </Timeline>
                </div>
              </Card>
            </Col>
          </Row>
        </TabPane>

        <TabPane tab="Análisis" key="analytics">
          {analytics ? (
            <div>
              {/* Executive Summary Cards */}
              <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" className="executive-card">
                    <Statistic
                      title="Proyectos Activos"
                      value={analytics.executiveSummary?.active_projects || 0}
                      suffix={`/ ${analytics.executiveSummary?.total_projects || 0}`}
                      prefix={<ProjectOutlined style={{ color: 'var(--color-info)' }} />}
                      valueStyle={{ color: 'var(--color-info)', fontSize: '20px' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                      {analytics.executiveSummary?.completed_projects || 0} completados
                    </div>
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" className="executive-card">
                    <Statistic
                      title="En Riesgo Crítico"
                      value={analytics.executiveSummary?.critical_projects || 0}
                      prefix={<AlertOutlined style={{ color: 'var(--color-error)' }} />}
                      valueStyle={{ color: 'var(--color-error)', fontSize: '20px' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                      {analytics.executiveSummary?.over_budget_projects === undefined
                        ? 'requieren atención'
                        : `${analytics.executiveSummary.over_budget_projects} sobre presupuesto`}
                    </div>
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" className="executive-card">
                    <Statistic
                      title="Desempeño Global"
                      value={analytics.executiveSummary?.avg_completion || 0}
                      suffix="%"
                      prefix={<RiseOutlined style={{ color: 'var(--color-success)' }} />}
                      valueStyle={{ color: 'var(--color-success)', fontSize: '20px' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                      {analytics.executiveSummary?.delayed_projects || 0} proyectos retrasados
                    </div>
                  </Card>
                </Col>
                <Col xs={24} sm={12} md={6}>
                  <Card size="small" className="executive-card">
                    <Statistic
                      title="Satisfacción Cliente"
                      value={analytics.executiveSummary?.avg_satisfaction || 0}
                      suffix="/10"
                      prefix={<TrophyOutlined style={{ color: 'var(--color-warning)' }} />}
                      valueStyle={{ color: 'var(--color-warning)', fontSize: '20px' }}
                    />
                    <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                      promedio general
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Main Analytics Grid */}
              <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
                {/* Budget Performance: el backend la envía solo a team_lead */}
                {showBudgetAnalytics && <Col xs={24} lg={12}>
                  <Card 
                    title={
                      <span>
                        <DollarOutlined style={{ marginRight: '8px', color: 'var(--color-success)' }} />
                        Desempeño Presupuestario
                      </span>
                    }
                    extra={
                      <Tag color="blue">
                        Varianza: {analytics.executiveSummary?.overall_budget_variance?.toFixed(1) || 0}%
                      </Tag>
                    }
                    size="small"
                  >
                    <div style={{ height: '300px', overflowY: 'auto' }}>
                      {analytics.budgetAnalysis?.slice(0, 8)?.map((project: any, index: number) => (
                        <div 
                          key={project.project_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            background: index % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--surface)',
                            borderRadius: '4px',
                            marginBottom: '4px',
                            border: project.budget_status === 'critical' ? '1px solid var(--color-error)' : '1px solid transparent'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                              {project.project_name}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              PM: {project.project_manager || 'Sin asignar'}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              Cronograma: {project.completion_percentage || 0}%
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '11px', fontWeight: 'bold' }}>
                              ${(project.planned_budget / 1000000).toFixed(1)}M
                            </div>
                            <Tag
                              color={
                                project.budget_status === 'critical' ? 'red' :
                                project.budget_status === 'warning' ? 'orange' :
                                project.budget_status === 'under_budget' ? 'green' : 'blue'
                              }
                            >
                              {project.cost_variance_percentage > 0 ? '+' : ''}{project.cost_variance_percentage?.toFixed(1) || 0}%
                            </Tag>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>}

                {/* Schedule Performance */}
                <Col xs={24} lg={showBudgetAnalytics ? 12 : 24}>
                  <Card 
                    title={
                      <span>
                        <ClockCircleOutlined style={{ marginRight: '8px', color: 'var(--color-info)' }} />
                        Desempeño de Cronograma
                      </span>
                    }
                    size="small"
                  >
                    <div style={{ height: '300px', overflowY: 'auto' }}>
                      {analytics.scheduleAnalysis?.slice(0, 8)?.map((project: any, index: number) => (
                        <div 
                          key={project.project_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            background: index % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--surface)',
                            borderRadius: '4px',
                            marginBottom: '4px',
                            border: project.schedule_status === 'severely_delayed' ? '1px solid var(--color-error)' : '1px solid transparent'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                              {project.project_name}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              {project.planned_end ? `Deadline: ${dayjs(project.planned_end).format('DD/MM/YY')}` : "Sin fecha límite"}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              Cronograma: {project.completion_percentage || 0}%
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{
                              fontSize: '11px',
                              fontWeight: 'bold',
                              color: project.days_to_deadline === null || project.days_to_deadline === undefined
                                ? 'var(--color-text-muted)'
                                : project.days_to_deadline < 0
                                  ? 'var(--color-error)'
                                  : project.days_to_deadline < 7
                                    ? 'var(--color-warning)'
                                    : 'var(--color-success)'
                            }}>
                              {project.days_to_deadline !== null ?
                                (project.days_to_deadline < 0 ? `${Math.abs(project.days_to_deadline)}d atrás` : `${project.days_to_deadline}d`) :
                                'N/A'
                              }
                            </div>
                            <Tag
                              color={
                                project.schedule_status === 'severely_delayed' ? 'red' :
                                project.schedule_status === 'delayed' ? 'orange' :
                                project.schedule_status === 'ahead_of_schedule' ? 'green' : 'blue'
                              }
                            >
                              {project.schedule_variance_days > 0 ? '+' : ''}{project.schedule_variance_days || 0}d
                            </Tag>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Risk Analysis & Team Performance */}
              <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
                <Col xs={24} lg={8}>
                  <Card 
                    title={
                      <span>
                        <WarningOutlined style={{ marginRight: '8px', color: 'var(--color-error)' }} />
                        Análisis de Riesgos
                      </span>
                    }
                    size="small"
                  >
                    <div style={{ height: '300px', overflowY: 'auto' }}>
                      {/* Risk Distribution */}
                      <div style={{ marginBottom: '16px' }}>
                        {analytics.riskDistribution?.map((risk: any) => (
                          <div key={risk.risk_level} style={{ marginBottom: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <span style={{ 
                                fontSize: '12px',
                                fontWeight: 'bold',
                                color: risk.risk_level === 'critical' ? 'var(--color-error)' : 
                                       risk.risk_level === 'high' ? 'var(--color-warning)' : 
                                       risk.risk_level === 'medium' ? 'var(--color-warning)' : 'var(--color-success)'
                              }}>
                                {displayLabel(risk.risk_level)}
                              </span>
                              <span style={{ fontSize: '11px' }}>{risk.project_count} ({risk.percentage}%)</span>
                            </div>
                            <Progress 
                              percent={risk.percentage} 
                              showInfo={false}
                              size="small"
                              strokeColor={
                                risk.risk_level === 'critical' ? 'var(--color-error)' :
                                risk.risk_level === 'high' ? 'var(--color-warning)' :
                                risk.risk_level === 'medium' ? 'var(--color-warning)' : 'var(--color-success)'
                              }
                            />
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                              Satisfacción: {risk.avg_satisfaction?.toFixed(1) || 'N/A'}/10
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* High Priority Projects */}
                      <Divider style={{ margin: '12px 0' }}>Proyectos Prioritarios</Divider>
                      {analytics.riskAnalysis?.filter((p: any) => p.priority_level === 'high_priority')?.slice(0, 3)?.map((project: any) => (
                        <Alert
                          key={project.project_id}
                          message={project.project_name}
                          description={`${displayLabel(project.risk_level)} - ${project.schedule_variance_days}d retraso`}
                          type="error"
                          style={{ marginBottom: '8px' }}
                          showIcon
                        />
                      ))}
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={8}>
                  <Card 
                    title={
                      <span>
                        <TeamOutlined style={{ marginRight: '8px', color: 'var(--color-info)' }} />
                        Rendimiento del equipo
                      </span>
                    }
                    size="small"
                  >
                    <div style={{ height: '300px', overflowY: 'auto' }}>
                      {analytics.teamAnalysis?.slice(0, 6)?.map((member: any, index: number) => (
                        <div 
                          key={member.full_name}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px',
                            background: index % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--surface)',
                            borderRadius: '6px',
                            marginBottom: '6px',
                            border: '1px solid var(--color-border)'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                              {member.full_name}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>
                              {member.role} • {member.total_projects} proyectos
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              Satisfacción: {member.avg_satisfaction?.toFixed(1) || 'N/A'}/10
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--color-info)' }}>
                              {member.avg_completion?.toFixed(0) || 0}%
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              Velocidad: {member.avg_velocity?.toFixed(1) || 'N/A'}
                            </div>
                            {member.avg_budget_variance !== undefined && (
                              <div style={{ fontSize: '11px', marginTop: '2px' }}>
                                <Tag color={member.avg_budget_variance > 10 ? 'red' : member.avg_budget_variance > 0 ? 'orange' : 'green'}>
                                  {member.avg_budget_variance > 0 ? '+' : ''}{member.avg_budget_variance?.toFixed(1) || 0}% budget
                                </Tag>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>

                <Col xs={24} lg={8}>
                  <Card 
                    title={
                      <span>
                        <BarChartOutlined style={{ marginRight: '8px', color: 'var(--color-success)' }} />
                        Calidad & Satisfacción
                      </span>
                    }
                    size="small"
                  >
                    <div style={{ height: '300px', overflowY: 'auto' }}>
                      {/* Quality Overview */}
                      <div style={{ marginBottom: '16px', padding: '8px', background: 'var(--color-surface-raised)', borderRadius: '4px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '4px' }}>
                          Resumen de Calidad
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                          Bugs totales: {analytics.qualityMetrics?.reduce((acc: number, p: any) => acc + (p.bugs_found || 0), 0) || 0}
                        </div>
                        <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                          Resueltos: {analytics.qualityMetrics?.reduce((acc: number, p: any) => acc + (p.bugs_resolved || 0), 0) || 0}
                        </div>
                      </div>

                      {/* Top Projects by Satisfaction */}
                      {analytics.qualityMetrics?.slice(0, 6)?.map((project: any, index: number) => (
                        <div 
                          key={project.project_id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            background: index % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--surface)',
                            borderRadius: '4px',
                            marginBottom: '4px',
                            border: project.quality_status === 'critical' ? '1px solid var(--color-error)' : '1px solid transparent'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '11px' }}>
                              {project.project_name}
                            </div>
                            <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                              Bugs: {project.bugs_found || 0} / Resueltos: {project.bugs_resolved || 0}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--color-warning)' }}>
                              {project.client_satisfaction_score?.toFixed(1) || 'N/A'}/10
                            </div>
                            <Tag
                              color={
                                project.quality_status === 'excellent' ? 'green' :
                                project.quality_status === 'good' ? 'blue' :
                                project.quality_status === 'needs_attention' ? 'orange' :
                                project.quality_status === 'critical' ? 'red' : 'default'
                              }
                            >
                              {project.resolution_rate?.toFixed(0) || 0}%
                            </Tag>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              </Row>

              {/* Client Satisfaction & Resource Utilization */}
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card 
                    title={
                      <span>
                        <TrophyOutlined style={{ marginRight: '8px', color: 'var(--color-warning)' }} />
                        Satisfacción por Cliente
                      </span>
                    }
                    size="small"
                  >
                    <Table
                      dataSource={analytics.satisfactionTrends?.slice(0, 8) || []}
                      columns={[
                        { 
                          title: 'Cliente', 
                          dataIndex: 'client_name', 
                          key: 'client_name',
                          width: 120,
                          render: (name: string) => (
                            <div style={{ fontSize: '11px', fontWeight: 'bold' }}>{name}</div>
                          )
                        },
                        { 
                          title: 'Proyectos', 
                          dataIndex: 'total_projects', 
                          key: 'total_projects',
                          width: 80,
                          align: 'center' as const
                        },
                        { 
                          title: 'Satisfacción', 
                          dataIndex: 'avg_satisfaction', 
                          key: 'avg_satisfaction',
                          width: 90,
                          render: (value: number) => (
                            <Tag color={value >= 8 ? 'green' : value >= 6 ? 'blue' : 'orange'}>
                              {value?.toFixed(1) || 'N/A'}/10
                            </Tag>
                          )
                        },
                        { 
                          title: 'A Tiempo', 
                          dataIndex: 'on_time_rate', 
                          key: 'on_time_rate',
                          width: 80,
                          render: (value: number) => `${value?.toFixed(0) || 0}%`
                        },
                        ...(showBudgetAnalytics ? [{ 
                          title: 'En Presupuesto', 
                          dataIndex: 'on_budget_rate', 
                          key: 'on_budget_rate',
                          width: 100,
                          render: (value: number) => (
                            <Tag color={value >= 80 ? 'green' : value >= 60 ? 'blue' : 'orange'}>
                              {value?.toFixed(0) || 0}%
                            </Tag>
                          )
                        }] : [])
                      ]}
                      size="small"
                      pagination={false}
                      scroll={{ y: 280 }}
                    />
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card 
                    title={
                      <span>
                        <ThunderboltOutlined style={{ marginRight: '8px', color: 'var(--color-info)' }} />
                        Utilización de Recursos
                      </span>
                    }
                    size="small"
                  >
                    <div style={{ height: '320px', overflowY: 'auto' }}>
                      {analytics.resourceUtilization?.map((resource: any, index: number) => (
                        <div 
                          key={resource.full_name}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '10px',
                            background: index % 2 === 0 ? 'var(--color-surface-raised)' : 'var(--surface)',
                            borderRadius: '6px',
                            marginBottom: '6px',
                            border: resource.utilization_status === 'overutilized' ? '1px solid var(--color-error)' : '1px solid var(--color-border)'
                          }}
                        >
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: '12px' }}>
                              {resource.full_name}
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)', marginBottom: '2px' }}>
                              {resource.role} • {resource.assigned_projects} proyectos
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              {resource.total_planned_hours}h plan / {resource.total_actual_hours}h real
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ 
                              fontSize: '14px', 
                              fontWeight: 'bold', 
                              color: resource.utilization_status === 'overutilized' ? 'var(--color-error)' : 
                                     resource.utilization_status === 'underutilized' ? 'var(--color-warning)' : 'var(--color-success)'
                            }}>
                              {resource.utilization_percentage?.toFixed(0) || 0}%
                            </div>
                            <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                              Velocidad: {resource.avg_velocity?.toFixed(1) || 'N/A'}
                            </div>
                            <Tag
                              color={
                                resource.utilization_status === 'overutilized' ? 'red' :
                                resource.utilization_status === 'underutilized' ? 'orange' : 'green'
                              }
                            >
                              {resource.utilization_status === 'overutilized' ? 'Sobrecargado' :
                               resource.utilization_status === 'underutilized' ? 'Subutilizado' : 'Óptimo'}
                            </Tag>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </Col>
              </Row>
            </div>
          ) : (
            <Card>
              <div style={{ textAlign: 'center', padding: '60px' }}>
                <BarChartOutlined style={{ fontSize: '48px', color: 'var(--color-border)', marginBottom: '16px' }} />
                <Title level={4} type="secondary">Cargando Analytics...</Title>
                <Text type="secondary">Preparando análisis avanzado de PMO</Text>
              </div>
            </Card>
          )}
        </TabPane>

        <TabPane tab="Gantt Chart" key="gantt">
          {!selectedProjectId ? (
            // Vista de selección de proyecto
            <Card title="Seleccionar Proyecto para Vista Gantt">
              <div style={{ textAlign: 'center', padding: '40px' }}>
                <Title level={4}>Selecciona un proyecto para abrir la vista Gantt</Title>
                {projects.length === 0 && !loading && (
                  <Alert
                    message="No se encontraron proyectos"
                    description="No hay proyectos disponibles para mostrar el Gantt Chart. Verifica que existan proyectos en el sistema."
                    type="warning"
                    style={{ marginBottom: '20px', textAlign: 'left' }}
                    showIcon
                  />
                )}
                <Select
                  size="large"
                  placeholder={projects.length === 0 ? "Cargando proyectos..." : "Elegir proyecto..."}
                  style={{ width: '300px', marginBottom: '20px' }}
                  value={selectedProjectId}
                  onChange={(value) => {
                    console.log('🎯 Project selected:', value);
                    setSelectedProjectId(value);
                  }}
                  loading={projects.length === 0}
                  notFoundContent={projects.length === 0 ? "Cargando..." : "No hay proyectos"}
                >
                  {projects.map((project: any) => (
                    <Select.Option key={project.id} value={project.id}>
                      {project.name}
                    </Select.Option>
                  ))}
                </Select>
                <br />
                <Text type="secondary">O selecciona un proyecto de la lista:</Text>
                <Table
                  dataSource={dashboardData?.projects || []}
                  columns={[
                    { 
                      title: 'Proyecto', 
                      dataIndex: 'name', 
                      key: 'name',
                      render: (name: string, record: any) => (
                        <Button 
                          type="link" 
                          onClick={() => {
                            console.log('🎯 Project selected from table:', record.id, name);
                            setSelectedProjectId(record.id);
                          }}
                          style={{ padding: 0, height: 'auto', fontWeight: 'bold' }}
                        >
                          {name}
                        </Button>
                      )
                    },
                    { 
                      title: 'Estado', 
                      dataIndex: 'status', 
                      key: 'status',
                      render: (status: string) => <Tag color="blue">{status}</Tag>
                    },
                    {
                      title: 'Avance del cronograma',
                      dataIndex: 'completion_percentage',
                      key: 'progress',
                      render: (value: number) => <Progress percent={value || 0} size="small" />
                    },
                    { 
                      title: 'Fechas', 
                      key: 'dates',
                      render: (record: any) => (
                        <Text type="secondary">
                          {record.start_date ? dayjs(record.start_date).format('DD/MM/YY') : 'N/A'} - {' '}
                          {record.end_date ? dayjs(record.end_date).format('DD/MM/YY') : 'N/A'}
                        </Text>
                      )
                    }
                  ]}
                  rowKey="id"
                  size="small"
                  pagination={{ pageSize: 5 }}
                />
              </div>
            </Card>
          ) : (
            // Nueva Vista Gantt Profesional
            <div>
              {ganttLoading ? (
                <Card>
                  <div style={{ textAlign: 'center', padding: '60px' }}>
                    <Title level={4}>Cargando cronograma...</Title>
                    <div>Preparando vista Gantt del proyecto</div>
                  </div>
                </Card>
              ) : ganttError ? (
                <Card>
                  <Alert
                    message="No se pudo cargar el cronograma"
                    description={ganttError}
                    type="error"
                    showIcon
                    action={
                      <Button 
                        size="small" 
                        type="primary" 
                        onClick={() => {
                          clearGanttError();
                          if (selectedProjectId) {
                            loadGanttData(selectedProjectId, true);
                          }
                        }}
                      >
                        
                        Reintentar
                      </Button>
                    }
                  />
                </Card>
              ) : (console.log('🎨 Render condition check:', { 
                hasGanttData: !!ganttData, 
                ganttLoading, 
                selectedProjectId,
                projectsCount: projects.length,
                dataStructure: ganttData ? Object.keys(ganttData) : 'null'
              }), ganttData) ? (
                <div>
                  {/* Header con controles principales */}
                  <Card size="small" style={{ marginBottom: '10px' }}>
                    <Row justify="space-between" align="middle">
                      <Col>
                        <Space>
                          <Button 
                            onClick={() => setSelectedProjectId(null)}
                          >
                            ← Volver
                          </Button>
                          <Title level={4} style={{ margin: 0 }}>
                            📊 {ganttData.project?.name || 'Proyecto'}
                          </Title>
                          <Tag color="blue">
                            {ganttData.project?.completion_percentage || 0}% del cronograma completado
                          </Tag>
                        </Space>
                      </Col>
                      <Col>
                        <Space>
                          {!isSelectionMode ? (
                            <>
                              <Button 
                                type="primary" 
                                icon={<PlusOutlined />}
                                onClick={() => setMilestoneModalVisible(true)}
                              >
                                Nuevo Hito
                              </Button>
                              <Button
                                icon={<PlusOutlined />}
                                onClick={() => setTaskModalVisible(true)}
                              >
                                Nueva Tarea
                              </Button>
                              <Button
                                icon={<DeleteOutlined />}
                                onClick={() => setIsSelectionMode(true)}
                                type="dashed"
                              >
                                Selección Múltiple
                              </Button>
                            </>
                          ) : (
                            <>
                              <Text strong>Modo Selección: {selectedItems.size} elementos</Text>
                              <Button size="small" onClick={handleSelectAll}>
                                Seleccionar Todo
                              </Button>
                              <Button size="small" onClick={handleSelectNone}>
                                Deseleccionar
                              </Button>
                              <Button 
                                type="primary" 
                                danger
                                icon={<DeleteOutlined />}
                                onClick={handleBatchDelete}
                                disabled={selectedItems.size === 0 || batchDeleting}
                                loading={batchDeleting}
                              >
                                Eliminar ({selectedItems.size})
                              </Button>
                              <Button 
                                onClick={() => {
                                  setIsSelectionMode(false);
                                  setSelectedItems(new Set());
                                }}
                              >
                                Cancelar
                              </Button>
                            </>
                          )}
                        </Space>
                        <Space style={{ marginLeft: 8 }}>
                          <Button 
                            icon={<ImportOutlined />}
                            onClick={() => setMermaidDrawerVisible(true)}
                          >
                            Importar Mermaid
                          </Button>
                          <Button>
                            Exportar
                          </Button>
                        </Space>
                      </Col>
                    </Row>
                  </Card>

                  {(ganttData.taskDependencies?.length > 0 || ganttData.projectDependencies?.length > 0) && <Card size="small" title="Dependencias registradas" style={{ marginBottom: 12 }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {(ganttData.taskDependencies || []).map((dependency: any) => <Text key={`task-dep-${dependency.id}`}>
                        {dependency.predecessor_title} → {dependency.successor_title}
                      </Text>)}
                      {(ganttData.projectDependencies || []).map((dependency: any) => <Text key={`project-dep-${dependency.id}`}>
                        {dependency.source_project_name} → {dependency.dependent_project_name}
                      </Text>)}
                    </Space>
                  </Card>}

                  {/* Vista Gantt Principal Alineada */}
                  <Card>
                    {/* Headers alineados */}
                    <div style={{ display: 'flex', marginBottom: '10px' }}>
                      {/* Header Panel Izquierdo */}
                      <div style={{ 
                        width: '350px', 
                        paddingRight: '10px'
                      }}>
                        <div style={{ 
                          background: 'var(--color-surface-raised)', 
                          padding: '8px 12px', 
                          borderRadius: '4px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderRight: '2px solid var(--color-border)'
                        }}>
                          <strong>ELEMENTOS DEL PROYECTO</strong>
                          <Text type="secondary">
                            {(ganttData.tasks?.length || 0) + (ganttData.milestones?.length || 0)} items
                          </Text>
                        </div>
                      </div>

                      {/* Header Timeline */}
                      <div style={{ flex: 1, paddingLeft: '10px' }}>
                        <div style={{ 
                          background: 'var(--color-surface-raised)', 
                          padding: '8px 12px', 
                          borderRadius: '4px',
                          textAlign: 'center'
                        }}>
                          <strong>CRONOGRAMA TEMPORAL</strong>
                        </div>
                      </div>
                    </div>

                    {/* Grilla de meses alineada con timeline */}
                    <div style={{ display: 'flex' }}>
                      <div style={{ width: '350px', paddingRight: '10px' }}>
                        {/* Espacio vacío para alinear con elementos */}
                      </div>
                      <div style={{ flex: 1, paddingLeft: '10px' }}>
                        <div style={{ 
                          display: 'grid', 
                          gridTemplateColumns: 'repeat(6, 1fr)', 
                          gap: '1px',
                          background: 'var(--color-border)',
                          padding: '1px',
                          borderRadius: '4px',
                          marginBottom: '10px'
                        }}>
                          {Array.from({ length: 6 }, (_, i) => {
                            const month = dayjs().add(i, 'month');
                            return (
                              <div 
                                key={i}
                                style={{ 
                                  background: 'var(--color-surface-raised)', 
                                  padding: '6px',
                                  textAlign: 'center',
                                  fontSize: '12px',
                                  fontWeight: 'bold'
                                }}
                              >
                                {month.format('MMM YYYY')}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Marcadores temporales */}
                    <div style={{ display: 'flex' }}>
                      <div style={{ width: '350px', paddingRight: '10px' }}>
                        {/* Espacio para alinear */}
                      </div>
                      <div style={{ flex: 1, paddingLeft: '10px' }}>
                        <div style={{ 
                          height: '30px',
                          display: 'flex',
                          borderBottom: '1px solid var(--color-border)',
                          marginBottom: '5px'
                        }}>
                          {Array.from({ length: 180 }, (_, i) => {
                            const date = dayjs().add(i, 'day');
                            const isMonthStart = date.date() === 1;
                            const isWeekStart = date.day() === 1;
                            
                            return (
                              <div 
                                key={i}
                                style={{ 
                                  width: '30px',
                                  borderRight: isMonthStart ? '2px solid var(--color-info)' : isWeekStart ? '1px solid var(--color-border)' : 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: '10px',
                                  color: isMonthStart ? 'var(--color-info)' : 'var(--color-text-muted)',
                                  fontWeight: isMonthStart ? 'bold' : 'normal'
                                }}
                              >
                                {isMonthStart ? date.format('MMM') : isWeekStart ? date.format('D') : ''}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {/* Contenido principal alineado */}
                    <div style={{ 
                      display: 'flex', 
                      height: '500px',
                      border: '1px solid var(--color-border)',
                      borderRadius: '4px'
                    }}>
                      {/* Panel izquierdo con elementos */}
                      <div style={{ 
                        width: '350px', 
                        borderRight: '2px solid var(--color-border)',
                        paddingRight: '10px',
                        overflowY: 'auto'
                      }}>
                        {[
                          ...(ganttData.milestones || []).map((milestone: any) => ({
                            ...milestone,
                            type: 'milestone',
                            sortDate: milestone.planned_date
                          })),
                          ...(ganttData.tasks || []).map((task: any) => ({
                            ...task,
                            type: 'task',
                            sortDate: task.start_date || task.created_at
                          }))
                        ]
                        .sort((a, b) => new Date(a.sortDate || '2099-12-31').getTime() - new Date(b.sortDate || '2099-12-31').getTime())
                        .map((item: any) => {
                          const responsibilityInfo = getResponsibilityIndicator(item.responsibility || 'internal');

                          return (
                          <div
                            key={`element-${item.type}-${item.id}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '8px',
                              height: '45px', // Altura fija para alineación
                              background: item.type === 'milestone' ? responsibilityInfo.bg : 'var(--color-surface-raised)',
                              borderRadius: '4px',
                              borderLeft: item.type === 'milestone' ? `4px solid ${responsibilityInfo.color}` : '4px solid var(--color-info)',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              marginBottom: '2px'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = item.type === 'milestone' ? 
                                (item.responsibility === 'external' ? 'var(--color-error-bg)' : 
                                 item.responsibility === 'client' ? 'var(--color-warning-bg)' : 
                                 item.responsibility === 'shared' ? 'var(--color-info-bg)' : 'var(--color-info-bg)') : 'var(--color-info-bg)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = item.type === 'milestone' ? responsibilityInfo.bg : 'var(--color-surface-raised)';
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ 
                                display: 'flex', 
                                alignItems: 'center',
                                marginBottom: '2px'
                              }}>
                                <span style={{ marginRight: '6px' }}>
                                  {item.type === 'milestone' ? responsibilityInfo.icon : '📋'}
                                </span>
                                <strong style={{ 
                                  fontSize: '12px',
                                  color: item.type === 'milestone' ? responsibilityInfo.color : 'var(--color-info)'
                                }}>
                                  {item.name || item.title}
                                </strong>
                                {item.type === 'milestone' && item.responsibility !== 'internal' && (
                                  <Tag
                                    color={
                                      item.responsibility === 'external' ? 'red' :
                                      item.responsibility === 'client' ? 'orange' : 'purple'
                                    }
                                    style={{ marginLeft: '8px', fontSize: '10px' }}
                                  >
                                    {responsibilityInfo.label}
                                  </Tag>
                                )}
                              </div>
                              <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                                {item.type === 'milestone' 
                                  ? item.actual_date
                                    ? `📅 ${dayjs(item.planned_date).format('DD/MM')} → ${dayjs(item.actual_date).format('DD/MM')}`
                                    : `📅 ${dayjs(item.planned_date).format('DD/MM/YY')}`
                                  : item.start_date && item.due_date
                                    ? `📅 ${dayjs(item.start_date).format('DD/MM')} → ${dayjs(item.due_date).format('DD/MM')}`
                                    : '📅 Sin fechas'
                                }
                                {' · '}{item.type === 'milestone' ? (item.responsible_name || 'Sin responsable') : (item.assignee_names || item.assignee_name || 'Sin responsable')}
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Tag
                                color={
                                  item.type === 'milestone'
                                    ? (item.status === 'completed' ? 'green' : 'orange')
                                    : (item.status === 'done' ? 'green' : item.status === 'in_progress' ? 'blue' : 'default')
                                }
                              >
                                {item.status === 'completed' || item.status === 'done' ? '✓' : 
                                 item.status === 'in_progress' ? '⏳' : '◯'}
                              </Tag>
                              <Space size={2}>
                                {isSelectionMode ? (
                                  <Checkbox
                                    checked={selectedItems.has(item.id)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      handleItemSelect(item.id);
                                    }}
                                    style={{ marginRight: '8px' }}
                                  />
                                ) : (
                                  <>
                                    <Button 
                                      type="text" 
                                      size="small" 
                                      icon={<EditOutlined />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleEditItem(item);
                                      }}
                                      style={{ 
                                        padding: '2px 4px',
                                        height: '20px',
                                        width: '20px',
                                        fontSize: '10px'
                                      }}
                                    />
                                    <Button 
                                      type="text" 
                                      size="small" 
                                      icon={<DeleteOutlined />}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteItem(item);
                                      }}
                                      style={{ 
                                        padding: '2px 4px',
                                        height: '20px',
                                        width: '20px',
                                        fontSize: '10px',
                                        color: 'var(--color-error)'
                                      }}
                                    />
                                  </>
                                )}
                              </Space>
                            </div>
                          </div>
                        );
                        })}
                      </div>

                      {/* Panel derecho con timeline alineado */}
                      <div style={{ 
                        flex: 1, 
                        paddingLeft: '10px',
                        position: 'relative',
                        overflowY: 'auto'
                      }}>
                        {/* Grilla de fondo */}
                        <div style={{ 
                          position: 'absolute',
                          top: 0,
                          left: 10,
                          right: 0,
                          height: '100%',
                          background: 'repeating-linear-gradient(to right, transparent, transparent 30px, var(--color-border) 30px, var(--color-border) 31px)',
                          pointerEvents: 'none'
                        }} />

                        {/* Elementos del timeline alineados */}
                        {[
                          ...(ganttData.milestones || []).map((milestone: any) => ({
                            ...milestone,
                            type: 'milestone',
                            sortDate: milestone.planned_date
                          })),
                          ...(ganttData.tasks || []).map((task: any) => ({
                            ...task,
                            type: 'task',
                            sortDate: task.start_date || task.created_at
                          }))
                        ]
                        .sort((a, b) => new Date(a.sortDate || '2099-12-31').getTime() - new Date(b.sortDate || '2099-12-31').getTime())
                        .map((item: any, index: number) => {
                          const startDate = item.type === 'milestone' 
                            ? dayjs(item.planned_date)
                            : dayjs(item.start_date || item.created_at);
                          const endDate = item.type === 'milestone' 
                            ? (item.actual_date ? dayjs(item.actual_date) : startDate)
                            : dayjs(item.due_date || startDate.add(7, 'day'));
                          
                          const daysSinceToday = startDate.diff(dayjs(), 'day');
                          const durationDays = item.type === 'milestone'
                            ? (item.actual_date ? Math.max(1, endDate.diff(startDate, 'day')) : 0)
                            : Math.max(1, endDate.diff(startDate, 'day'));

                          const baselinePlannedDate = item.type === 'milestone' && item.baseline_planned_date
                            ? dayjs(item.baseline_planned_date)
                            : null;
                          const baselineDaysSinceToday = baselinePlannedDate ? baselinePlannedDate.diff(dayjs(), 'day') : null;
                          const baselineLeftPosition = baselineDaysSinceToday !== null ? Math.max(0, baselineDaysSinceToday * 30) : null;

                          const leftPosition = Math.max(0, daysSinceToday * 30);
                          const width = item.type === 'milestone' 
                            ? (item.actual_date ? Math.max(30, durationDays * 30) : 20)
                            : Math.max(30, durationDays * 30);
                          
                          // Solo mostrar elementos dentro del rango visible
                          if (daysSinceToday > 180 || daysSinceToday < -30) return null;
                          
                          return (
                            <div
                              key={`timeline-${item.type}-${item.id}`}
                              style={{
                                position: 'relative',
                                height: '47px', // Misma altura que elementos izquierda (45px + 2px margin)
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center'
                              }}
                              onClick={() => handleEditItem(item)}
                            >
                              {item.type === 'milestone' ? (
                                item.actual_date ? (
                                  // Hito con duración
                                  <>
                                    <div
                                      style={{
                                        position: 'absolute',
                                        left: `${leftPosition}px`,
                                        top: '15px',
                                        width: `${width}px`,
                                        height: '16px',
                                        background: item.status === 'completed' 
                                          ? 'linear-gradient(90deg, var(--color-warning), var(--color-success))' 
                                          : 'linear-gradient(90deg, var(--color-warning), var(--color-warning))',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(255,255,255,0.8)',
                                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '0 4px',
                                        fontSize: '10px',
                                        color: 'var(--surface)',
                                        fontWeight: 'bold'
                                      }}
                                      title={`${item.name} - ${startDate.format('DD/MM')} → ${endDate.format('DD/MM')} (${durationDays} días)`}
                                    >
                                      {width > 60 ? `🎯 ${item.name.substring(0, 6)}...` : '🎯'}
                                    </div>
                                    <div
                                      style={{
                                        position: 'absolute',
                                        left: `${leftPosition + width - 10}px`,
                                        top: '11px',
                                        width: '12px',
                                        height: '12px',
                                        background: item.status === 'completed' ? 'var(--color-success)' : 'var(--color-warning)',
                                        transform: 'rotate(45deg)',
                                        border: '1px solid white',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                        zIndex: 6
                                      }}
                                    />
                                  </>
                                ) : (
                                  // Hito puntual
                                  <div
                                    style={{
                                      position: 'absolute',
                                      left: `${leftPosition}px`,
                                      top: '13px',
                                      width: '20px',
                                      height: '20px',
                                      background: item.status === 'completed' ? 'var(--color-success)' : 'var(--color-warning)',
                                      transform: 'rotate(45deg)',
                                      border: '2px solid white',
                                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                                      zIndex: 5
                                    }}
                                    title={`${item.name} - ${startDate.format('DD/MM/YYYY')}`}
                                  />
                                )
                              ) : (
                                // Tarea como barra
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: `${leftPosition}px`,
                                    top: '15px',
                                    width: `${width}px`,
                                    height: '16px',
                                    background: item.status === 'done' 
                                      ? 'linear-gradient(90deg, var(--color-success), var(--color-success))' 
                                      : item.status === 'in_progress' 
                                        ? 'linear-gradient(90deg, var(--color-info), var(--color-info))'
                                        : 'linear-gradient(90deg, var(--color-border), var(--color-border))',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.8)',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '0 4px',
                                    fontSize: '10px',
                                    color: ['done', 'in_progress'].includes(item.status) ? 'var(--color-on-accent)' : 'var(--ink)',
                                    fontWeight: 'bold'
                                  }}
                                  title={`${item.title} - ${startDate.format('DD/MM')} → ${endDate.format('DD/MM')}`}
                                >
                                  {width > 60 ? (item.title?.substring(0, 8) + '...') : ''}
                                </div>
                              )}

                              {baselineLeftPosition !== null && (
                                <div
                                  title={`Baseline: ${baselinePlannedDate!.format('DD/MM/YYYY')}`}
                                  style={{
                                    position: 'absolute',
                                    left: `${baselineLeftPosition}px`,
                                    top: 4,
                                    width: '3px',
                                    height: '37px',
                                    background: 'var(--color-text-muted)',
                                    borderRadius: '1px',
                                    zIndex: 1
                                  }}
                                />
                              )}

                              {/* Línea de hoy solo en el primer elemento */}
                              {index === 0 && (
                                <div
                                  style={{
                                    position: 'absolute',
                                    left: '0px',
                                    top: 0,
                                    bottom: 0,
                                    width: '2px',
                                    background: 'var(--color-error)',
                                    zIndex: 10
                                  }}
                                  title="Hoy"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </Card>
                </div>
              ) : (
                <Card>
                  <div style={{ textAlign: 'center', padding: '60px' }}>
                    <Text type="secondary">No se encontraron datos del proyecto seleccionado</Text>
                  </div>
                </Card>
              )}
            </div>
          )}
        </TabPane>

        <TabPane tab="🔗 Dependencias Externas" key="dependencies">
          <Card>
            <Title level={3} style={{ marginBottom: '20px' }}>
              📊 Dashboard de Dependencias Externas
            </Title>
            
            {/* Métricas de dependencias */}
            <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
              <Col xs={24} sm={8}>
                <Card size="small" style={{ background: 'var(--color-error-bg)', borderColor: 'var(--color-error-bg)' }}>
                  <Statistic
                    title="Dependencias Externas"
                    value={
                      dashboardData?.projects?.reduce((total: number, _project: any) => {
                        return total + (ganttData?.milestones?.filter((m: any) => 
                          m.responsibility === 'external' || m.responsibility === 'client'
                        ).length || 0);
                      }, 0) || 0
                    }
                    prefix="🏪"
                    valueStyle={{ color: 'var(--color-error)' }}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" style={{ background: 'var(--color-warning-bg)', borderColor: 'var(--color-warning-bg)' }}>
                  <Statistic
                    title="Retrasos por Cliente"
                    value={
                      ganttData?.milestones?.filter((m: any) => 
                        m.responsibility === 'client' && m.estimated_delay_days > 0
                      ).length || 0
                    }
                    prefix="⏰"
                    valueStyle={{ color: 'var(--color-warning)' }}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" style={{ background: 'var(--color-primary-bg)', borderColor: 'var(--color-primary-bg)' }}>
                  <Statistic
                    title="Impacto Financiero"
                    value={Math.round(
                      (ganttData?.milestones?.reduce((total: number, m: any) => 
                        total + (parseFloat(m.financial_impact) || 0), 0
                      ) || 0) / 1000000
                    )}
                    suffix="M CLP"
                    prefix="💰"
                    valueStyle={{ color: 'var(--color-success)' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* Lista de dependencias críticas */}
            <Row gutter={[16, 16]}>
              <Col span={24}>
                <Card 
                  title="🚨 Dependencias Críticas por Cliente/Terceros" 
                  size="small"
                  style={{ marginBottom: '16px' }}
                >
                  {ganttData?.milestones?.filter((m: any) => 
                    m.responsibility !== 'internal'
                  ).length > 0 ? (
                    <div>
                      {ganttData.milestones
                        .filter((m: any) => m.responsibility !== 'internal')
                        .map((milestone: any) => {
                          const responsibilityInfo = getResponsibilityIndicator(milestone.responsibility);
                          const isDelayed = milestone.estimated_delay_days > 0;
                          
                          return (
                            <Card 
                              key={milestone.id}
                              size="small" 
                              style={{ 
                                marginBottom: '12px',
                                border: isDelayed ? '2px solid var(--color-error)' : '1px solid var(--color-border)',
                                background: isDelayed ? 'var(--color-error-bg)' : responsibilityInfo.bg
                              }}
                            >
                              <Row justify="space-between" align="middle">
                                <Col span={12}>
                                  <Space>
                                    <span style={{ fontSize: '16px' }}>{responsibilityInfo.icon}</span>
                                    <div>
                                      <strong>{milestone.name}</strong>
                                      <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                        📅 {dayjs(milestone.planned_date).format('DD/MM/YYYY')}
                                      </div>
                                    </div>
                                  </Space>
                                </Col>
                                <Col span={6}>
                                  <Tag color={responsibilityInfo.color.replace('#', '')}>
                                    {responsibilityInfo.label}
                                  </Tag>
                                  {isDelayed && (
                                    <Tag color="red" style={{ marginTop: '4px' }}>
                                      +{milestone.estimated_delay_days} días
                                    </Tag>
                                  )}
                                </Col>
                                <Col span={6}>
                                  {milestone.financial_impact > 0 && (
                                    <div style={{ textAlign: 'right' }}>
                                      <strong style={{ color: 'var(--color-error)' }}>
                                        ${(milestone.financial_impact / 1000000).toFixed(1)}M
                                      </strong>
                                      <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                                        Impacto CLP
                                      </div>
                                    </div>
                                  )}
                                  {milestone.external_contact && (
                                    <div style={{ fontSize: '10px', color: 'var(--color-text-secondary)' }}>
                                      👤 {milestone.external_contact}
                                    </div>
                                  )}
                                </Col>
                              </Row>
                              
                              {milestone.blocking_reason && (
                                <div style={{ marginTop: '8px', padding: '8px', background: 'var(--color-surface-raised)', borderRadius: '4px' }}>
                                  <strong style={{ fontSize: '11px' }}>Razón del bloqueo:</strong>
                                  <div style={{ fontSize: '11px', marginTop: '2px' }}>
                                    {milestone.blocking_reason}
                                  </div>
                                </div>
                              )}
                              
                              {milestone.delay_justification && (
                                <div style={{ marginTop: '4px', padding: '8px', background: 'var(--color-warning-bg)', borderRadius: '4px' }}>
                                  <strong style={{ fontSize: '11px' }}>Justificación:</strong>
                                  <div style={{ fontSize: '11px', marginTop: '2px' }}>
                                    {milestone.delay_justification}
                                  </div>
                                </div>
                              )}
                            </Card>
                          );
                        })}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-muted)' }}>
                      <CheckCircleOutlined style={{ fontSize: '48px', marginBottom: '16px' }} />
                      <div>¡Excelente! No hay dependencias externas críticas</div>
                      <div style={{ fontSize: '12px', marginTop: '8px' }}>
                        Todos los hitos están bajo control interno
                      </div>
                    </div>
                  )}
                </Card>
              </Col>
            </Row>
          </Card>
        </TabPane>

        <TabPane tab="👥 Capacidad FTE" key="capacity">
          <Card
            title={
              <Space>
                <TeamOutlined />
                <span>Balance y Carga de Capacidad del Equipo</span>
              </Space>
            }
            extra={
              <Button icon={<ReloadOutlined />} onClick={loadTeamCapacity} loading={capacityLoading}>
                Actualizar
              </Button>
            }
          >
            {/* KPI Summary Cards */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic
                    title="Equipo Total"
                    value={teamCapacityData?.summary?.total_members ?? 0}
                    prefix={<TeamOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic
                    title="Sobreasignados (>1.05 FTE)"
                    value={teamCapacityData?.summary?.overallocated ?? 0}
                    valueStyle={{ color: (teamCapacityData?.summary?.overallocated ?? 0) > 0 ? '#cf1322' : '#3f8600' }}
                    prefix={<AlertOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic
                    title="Carga Óptima (0.8 - 1.05 FTE)"
                    value={teamCapacityData?.summary?.optimal ?? 0}
                    valueStyle={{ color: '#3f8600' }}
                    prefix={<CheckCircleOutlined />}
                  />
                </Card>
              </Col>
              <Col xs={12} sm={6}>
                <Card size="small">
                  <Statistic
                    title="Capacidad Disponible (<0.80 FTE)"
                    value={teamCapacityData?.summary?.available ?? 0}
                    valueStyle={{ color: '#1677ff' }}
                    prefix={<ClockCircleOutlined />}
                  />
                </Card>
              </Col>
            </Row>

            {/* Table / List of Team Capacity */}
            <Table
              dataSource={teamCapacityData?.data || []}
              rowKey="id"
              loading={capacityLoading}
              pagination={false}
              expandable={{
                expandedRowRender: (record: any) => (
                  <div style={{ margin: '8px 16px' }}>
                    <Text strong style={{ display: 'block', marginBottom: 8 }}>
                      Proyectos y dedicación asignada:
                    </Text>
                    {record.assignments?.length ? (
                      <Table
                        size="small"
                        rowKey="project_id"
                        pagination={false}
                        dataSource={record.assignments}
                        columns={[
                          {
                            title: 'Proyecto',
                            dataIndex: 'project_name',
                            render: (val: string, item: any) => (
                              <span>
                                <strong>{val}</strong> {item.project_code ? `(${item.project_code})` : ''}
                              </span>
                            )
                          },
                          { title: 'Rol', dataIndex: 'role' },
                          {
                            title: 'Dedicación',
                            dataIndex: 'allocation_percentage',
                            render: (v: number) => `${Number(v || 0)}% (${(Number(v || 0) / 100).toFixed(2)} FTE)`
                          },
                          {
                            title: 'Horas presupuestadas',
                            dataIndex: 'budgeted_hours',
                            render: (v: number) => (v != null ? `${Number(v).toLocaleString('es-CL')} h` : '—')
                          },
                          {
                            title: 'Horas reales',
                            dataIndex: 'actual_hours',
                            render: (v: number) => `${Number(v || 0).toLocaleString('es-CL')} h`
                          },
                          {
                            title: 'Periodo',
                            render: (_: any, item: any) => `${item.start_date || 'Sin inicio'} — ${item.end_date || 'Sin término'}`
                          }
                        ]}
                      />
                    ) : (
                      <Text type="secondary">Sin proyectos activos asignados actualmente.</Text>
                    )}
                  </div>
                ),
                rowExpandable: (record: any) => Boolean(record.assignments?.length)
              }}
              columns={[
                {
                  title: 'Integrante',
                  dataIndex: 'full_name',
                  render: (val: string, record: any) => (
                    <div>
                      <div style={{ fontWeight: 600 }}>{val}</div>
                      <div style={{ fontSize: 12, color: '#888' }}>{record.email} · {record.role}</div>
                    </div>
                  )
                },
                {
                  title: 'Proyectos',
                  dataIndex: 'active_projects_count',
                  width: 120,
                  render: (v: number) => <Tag color="blue">{v} {v === 1 ? 'proyecto' : 'proyectos'}</Tag>
                },
                {
                  title: 'Carga FTE Total',
                  dataIndex: 'total_fte',
                  width: 280,
                  render: (val: number, record: any) => {
                    const percent = Math.min(Math.round(val * 100), 200);
                    const strokeColor =
                      record.status === 'overallocated'
                        ? '#ff4d4f'
                        : record.status === 'optimal'
                        ? '#52c41a'
                        : '#1890ff';
                    return (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span><strong>{Number(val).toFixed(2)} FTE</strong> ({Math.round(val * 100)}%)</span>
                          <Tag color={record.status === 'overallocated' ? 'error' : record.status === 'optimal' ? 'success' : 'processing'}>
                            {record.status === 'overallocated' ? 'Sobreasignado' : record.status === 'optimal' ? 'Carga Óptima' : 'Disponible'}
                          </Tag>
                        </div>
                        <Progress percent={Math.min(percent, 100)} strokeColor={strokeColor} showInfo={false} size="small" />
                      </div>
                    );
                  }
                },
                {
                  title: 'Horas Presupuestadas',
                  dataIndex: 'total_budgeted_hours',
                  width: 160,
                  render: (v: number) => `${Number(v || 0).toLocaleString('es-CL')} h`
                },
                {
                  title: 'Horas Reales Imputadas',
                  dataIndex: 'total_actual_hours',
                  width: 170,
                  render: (v: number) => `${Number(v || 0).toLocaleString('es-CL')} h`
                }
              ]}
            />
          </Card>
        </TabPane>
      </Tabs>
        </>
      )}

      {/* Modal editar elemento */}
      <Modal
        title={`Editar ${editingItem?.type === 'milestone' ? 'Hito' : 'Tarea'}`}
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setEditingItem(null);
          editForm.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={handleSaveEdit}
        >
          {editingItem?.type === 'milestone' ? (
            // Formulario para hitos
            <>
              <Form.Item name="name" label="Nombre del Hito" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="description" label="Descripción">
                <Input.TextArea />
              </Form.Item>
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="planned_date" label="Fecha de Inicio" rules={[{ required: true }]}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="end_date" label="Fecha de Fin">
                    <DatePicker style={{ width: '100%' }} placeholder="Fecha planificada de fin" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="actual_date" label="Fecha Real">
                    <DatePicker style={{ width: '100%' }} placeholder="Fecha real de finalización" />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="status" label="Estado">
                <Select>
                  <Select.Option value="pending">Pendiente</Select.Option>
                  <Select.Option value="in_progress">En Progreso</Select.Option>
                  <Select.Option value="completed">Completado</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="responsible_user_id" label="Responsable">
                <Select placeholder="Seleccionar responsable">
                  {users.map((user: any) => (
                    <Select.Option key={user.id} value={user.id}>
                      {user.full_name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item name="responsibility" label="Tipo de Responsabilidad">
                <Select>
                  <Select.Option value="internal">
                    <span style={{ color: 'var(--color-info)' }}>🏢 Interno</span> - Tu equipo
                  </Select.Option>
                  <Select.Option value="client">
                    <span style={{ color: 'var(--color-warning)' }}>👤 Cliente</span> - Responsabilidad del cliente
                  </Select.Option>
                  <Select.Option value="external">
                    <span style={{ color: 'var(--color-error)' }}>🏪 Externo</span> - Proveedores/Terceros
                  </Select.Option>
                  <Select.Option value="shared">
                    <span style={{ color: 'var(--color-info)' }}>🤝 Compartido</span> - Colaboración requerida
                  </Select.Option>
                </Select>
              </Form.Item>

              <Form.Item 
                shouldUpdate={(prevValues, currentValues) => prevValues.responsibility !== currentValues.responsibility}
                style={{ marginBottom: 0 }}
              >
                {({ getFieldValue }) => {
                  const responsibility = getFieldValue('responsibility');
                  return responsibility !== 'internal' ? (
                    <div>
                      <Form.Item name="external_contact" label="Contacto Externo">
                        <Input placeholder="Nombre y contacto del responsable externo" />
                      </Form.Item>

                      <Form.Item name="blocking_reason" label="Razón de Bloqueo/Dependencia">
                        <Input.TextArea 
                          placeholder="Describe por qué este hito depende de factores externos"
                          rows={2}
                        />
                      </Form.Item>

                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item name="estimated_delay_days" label="Días de Retraso Estimados">
                            <Input type="number" min={0} placeholder="0" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="financial_impact" label="Impacto Financiero (CLP)">
                            <Input type="number" min={0} step="1000" placeholder="0" />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Form.Item name="delay_justification" label="Justificación/Evidencias">
                        <Input.TextArea 
                          placeholder="Documentación o evidencias del retraso/dependencia"
                          rows={2}
                        />
                      </Form.Item>
                    </div>
                  ) : null;
                }}
              </Form.Item>
            </>
          ) : (
            // Formulario para tareas
            <>
              <Form.Item name="title" label="Título de la Tarea" rules={[{ required: true }]}>
                <Input />
              </Form.Item>
              <Form.Item name="description" label="Descripción">
                <Input.TextArea />
              </Form.Item>
              <Form.Item name="start_date" label="Fecha de Inicio">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="due_date" label="Fecha de Vencimiento">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item name="status" label="Estado">
                <Select>
                  <Select.Option value="todo">Por Hacer</Select.Option>
                  <Select.Option value="in_progress">En Progreso</Select.Option>
                  <Select.Option value="review">En Revisión</Select.Option>
                  <Select.Option value="testing">Pruebas</Select.Option>
                  <Select.Option value="done">Completado</Select.Option>
                  <Select.Option value="blocked">Bloqueado</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item name="assignee_ids" label="Responsables">
                <Select mode="multiple" placeholder="Seleccionar responsables">
                  {users.map((user: any) => (
                    <Select.Option key={user.id} value={user.id}>
                      {user.full_name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item name="estimated_hours" label="Horas Estimadas">
                <Input type="number" min={0} step={0.5} />
              </Form.Item>
            </>
          )}
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Guardar Cambios
              </Button>
              <Button onClick={() => {
                setEditModalVisible(false);
                setEditingItem(null);
                editForm.resetFields();
              }}>
                Cancelar
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal crear hito */}
      <Modal
        title={selectedProjectId 
          ? `Crear Nuevo Hito - ${projects.find(p => p.id === selectedProjectId)?.name || 'Proyecto'}`
          : "Crear Nuevo Hito"
        }
        open={milestoneModalVisible}
        onCancel={() => setMilestoneModalVisible(false)}
        footer={null}
      >
        <Form
          form={milestoneForm}
          layout="vertical"
          onFinish={handleCreateMilestone}
        >
          <Form.Item
            name="project_id"
            label="Proyecto"
            rules={[{ required: true, message: 'Selecciona un proyecto' }]}
          >
            {selectedProjectId ? (
              <div>
                <Select 
                  value={selectedProjectId} 
                  disabled 
                  style={{ width: '100%' }}
                >
                  <Select.Option value={selectedProjectId}>
                    {projects.find(p => p.id === selectedProjectId)?.name || 'Proyecto Seleccionado'}
                  </Select.Option>
                </Select>
                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                  Proyecto seleccionado desde el Gantt Chart
                </div>
              </div>
            ) : (
              <Select placeholder="Seleccionar proyecto">
                {projects.map((project: any) => (
                  <Select.Option key={project.id} value={project.id}>
                    {project.name}
                  </Select.Option>
                ))}
              </Select>
            )}
          </Form.Item>

          <Form.Item
            name="name"
            label="Nombre del Hito"
            rules={[{ required: true, message: 'Ingresa el nombre del hito' }]}
          >
            <Input placeholder="Ej: Demo al cliente" />
          </Form.Item>

          <Form.Item name="description" label="Descripción">
            <Input.TextArea placeholder="Descripción detallada del hito" />
          </Form.Item>

          <Form.Item name="milestone_type" label="Tipo" initialValue="delivery">
            <Select>
              <Select.Option value="delivery">Entrega</Select.Option>
              <Select.Option value="demo">Demo</Select.Option>
              <Select.Option value="review">Revisión</Select.Option>
              <Select.Option value="go_live">Go Live</Select.Option>
              <Select.Option value="checkpoint">Checkpoint</Select.Option>
              <Select.Option value="deadline">Fecha límite</Select.Option>
            </Select>
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                name="planned_date"
                label="Fecha de Inicio"
                rules={[{ required: true, message: 'Selecciona una fecha' }]}
              >
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="end_date" label="Fecha de Fin">
                <DatePicker style={{ width: '100%' }} placeholder="Fecha planificada de fin" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="actual_date" label="Fecha Real">
                <DatePicker style={{ width: '100%' }} placeholder="Opcional - fecha real" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item name="priority" label="Prioridad" initialValue="medium">
            <Select>
              <Select.Option value="critical">Crítica</Select.Option>
              <Select.Option value="high">Alta</Select.Option>
              <Select.Option value="medium">Media</Select.Option>
              <Select.Option value="low">Baja</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item name="responsible_user_id" label="Responsable">
            <Select placeholder="Seleccionar responsable">
              {users.map((user: any) => (
                <Select.Option key={user.id} value={user.id}>
                  {user.full_name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item name="responsibility" label="Tipo de Responsabilidad" initialValue="internal">
            <Select>
              <Select.Option value="internal">
                <span style={{ color: 'var(--color-info)' }}>🏢 Interno</span> - Tu equipo
              </Select.Option>
              <Select.Option value="client">
                <span style={{ color: 'var(--color-warning)' }}>👤 Cliente</span> - Responsabilidad del cliente
              </Select.Option>
              <Select.Option value="external">
                <span style={{ color: 'var(--color-error)' }}>🏪 Externo</span> - Proveedores/Terceros
              </Select.Option>
              <Select.Option value="shared">
                <span style={{ color: 'var(--color-info)' }}>🤝 Compartido</span> - Colaboración requerida
              </Select.Option>
            </Select>
          </Form.Item>

          <Form.Item 
            shouldUpdate={(prevValues, currentValues) => prevValues.responsibility !== currentValues.responsibility}
            style={{ marginBottom: 0 }}
          >
            {({ getFieldValue }) => {
              const responsibility = getFieldValue('responsibility');
              return responsibility !== 'internal' ? (
                <div>
                  <Form.Item name="external_contact" label="Contacto Externo">
                    <Input placeholder="Nombre y contacto del responsable externo" />
                  </Form.Item>

                  <Form.Item name="blocking_reason" label="Razón de Bloqueo/Dependencia">
                    <Input.TextArea 
                      placeholder="Describe por qué este hito depende de factores externos"
                      rows={2}
                    />
                  </Form.Item>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item name="estimated_delay_days" label="Días de Retraso Estimados">
                        <Input type="number" min={0} placeholder="0" />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item name="financial_impact" label="Impacto Financiero (CLP)">
                        <Input type="number" min={0} step="1000" placeholder="0" />
                      </Form.Item>
                    </Col>
                  </Row>

                  <Form.Item name="delay_justification" label="Justificación/Evidencias">
                    <Input.TextArea 
                      placeholder="Documentación o evidencias del retraso/dependencia"
                      rows={2}
                    />
                  </Form.Item>
                </div>
              ) : null;
            }}
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Crear Hito
              </Button>
              <Button onClick={() => setMilestoneModalVisible(false)}>
                Cancelar
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Modal crear tarea */}
      <Modal
        title="Crear Nueva Tarea"
        open={taskModalVisible}
        onCancel={() => setTaskModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          form={taskForm}
          layout="vertical"
          onFinish={handleCreateTask}
        >
          <Form.Item
            name="title"
            label="Título de la Tarea"
            rules={[{ required: true, message: 'Ingresa el título de la tarea' }]}
          >
            <Input placeholder="Ej: Configurar base de datos" />
          </Form.Item>

          <Form.Item name="description" label="Descripción">
            <Input.TextArea placeholder="Descripción detallada de la tarea" rows={3} />
          </Form.Item>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="start_date" label="Fecha de Inicio">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="due_date" label="Fecha de Vencimiento">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="status" label="Estado" initialValue="todo">
                <Select>
                  <Select.Option value="todo">Por Hacer</Select.Option>
                  <Select.Option value="in_progress">En Progreso</Select.Option>
                  <Select.Option value="review">En Revisión</Select.Option>
                  <Select.Option value="testing">Pruebas</Select.Option>
                  <Select.Option value="done">Completado</Select.Option>
                  <Select.Option value="blocked">Bloqueado</Select.Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="priority" label="Prioridad" initialValue="medium">
                <Select>
                  <Select.Option value="critical">Crítica</Select.Option>
                  <Select.Option value="high">Alta</Select.Option>
                  <Select.Option value="medium">Media</Select.Option>
                  <Select.Option value="low">Baja</Select.Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="assignee_ids" label="Responsables">
                <Select mode="multiple" placeholder="Seleccionar responsables">
                  {users.map((user: any) => (
                    <Select.Option key={user.id} value={user.id}>
                      {user.full_name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="estimated_hours" label="Horas Estimadas">
                <Input type="number" min={0} step={0.5} placeholder="Ej: 8" />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Crear Tarea
              </Button>
              <Button onClick={() => setTaskModalVisible(false)}>
                Cancelar
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Mermaid Import Drawer */}
      <Drawer
        title="Importar Diagrama Mermaid"
        placement="right"
        width={600}
        onClose={() => setMermaidDrawerVisible(false)}
        open={mermaidDrawerVisible}
        extra={
          <Space>
            <Button onClick={() => setMermaidDrawerVisible(false)}>
              Cancelar
            </Button>
            <Button 
              type="primary" 
              onClick={handleMermaidImport}
            >
              Importar
            </Button>
          </Space>
        }
      >
        <div style={{ marginBottom: '16px' }}>
          <Alert
            message="Importar Diagrama Mermaid"
            description="Pega tu código Mermaid aquí o sube un archivo .mmd para convertirlo automáticamente en tareas y milestones del proyecto."
            type="info"
            showIcon
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <Typography.Title level={5}>
            <FileTextOutlined /> Subir archivo Mermaid
          </Typography.Title>
          <Upload.Dragger
            accept=".mmd,.txt"
            beforeUpload={(file) => {
              const reader = new FileReader();
              reader.onload = (e) => {
                const content = e.target?.result as string;
                setMermaidCode(content);
              };
              reader.readAsText(file);
              return false;
            }}
            showUploadList={false}
          >
            <p className="ant-upload-drag-icon">
              <ImportOutlined />
            </p>
            <p className="ant-upload-text">Haz clic o arrastra archivos .mmd aquí</p>
            <p className="ant-upload-hint">
              Soporta archivos .mmd y .txt con código Mermaid
            </p>
          </Upload.Dragger>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <Typography.Title level={5}>
            <CodeOutlined /> O pega tu código Mermaid
          </Typography.Title>
          <Input.TextArea
            placeholder="gantt
    title Proyecto Ejemplo
    dateFormat  YYYY-MM-DD
    axisFormat  %d/%m

    section Fase 1
    Análisis          :done, des1, 2024-01-01, 2024-01-15
    Diseño           :active, des2, 2024-01-16, 30d
    
    section Fase 2
    Desarrollo       :dev1, after des2, 45d
    Pruebas         :test1, after dev1, 15d"
            rows={12}
            value={mermaidCode}
            onChange={(e) => setMermaidCode(e.target.value)}
            style={{ fontFamily: 'monospace' }}
          />
        </div>

        <div>
          <Typography.Title level={5}>Ejemplo de formato Mermaid:</Typography.Title>
          <Card size="small" style={{ background: 'var(--color-surface-raised)' }}>
            <pre style={{ margin: 0, fontSize: '12px' }}>
{`gantt
    title Mi Proyecto
    dateFormat YYYY-MM-DD
    axisFormat %d/%m

    section Análisis
    Requisitos       :done, req1, 2024-01-01, 2024-01-10
    Documentación    :active, doc1, 2024-01-11, 15d
    
    section Desarrollo  
    Backend         :dev1, after doc1, 30d
    Frontend        :dev2, after dev1, 25d
    
    section Testing
    Pruebas         :test1, after dev2, 10d
    Deploy          :deploy1, after test1, 3d`}
            </pre>
          </Card>
        </div>
      </Drawer>
    </div>
  );
};

export default PMODashboard;
