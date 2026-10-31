import React, { useState, useEffect } from 'react';
import {
  Card,
  Button,
  Select,
  Typography,
  Space,
  Row,
  Col,
  Tag,
  Checkbox,
  Modal,
  Form,
  Input,
  DatePicker,
  message,
  Tooltip,
  Badge,
  Divider,
  Segmented,
  Table
} from 'antd';
import {
  PlusOutlined,
  UserOutlined,
  CalendarOutlined,
  EditOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  CheckSquareOutlined,
  TeamOutlined,
  LinkOutlined,
  RocketOutlined,
  PlayCircleOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiService } from '@/services/api';
import { TaskSubtasksChecklist } from '@/components/tasks/TaskSubtasksChecklist';
import { CommentsThread } from '@/components/comments/CommentsThread';
import { TaskTagsEditor } from '@/components/tasks/TaskTagsEditor';
import { TaskCollaboratorsEditor } from '@/components/tasks/TaskCollaboratorsEditor';
import { TaskDependenciesEditor } from '@/components/tasks/TaskDependenciesEditor';
import { EmptyState, LoadingState } from '@/components/common';
import { getPriorityColor } from '@/utils';
import dayjs from 'dayjs';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

interface Project {
  id: number;
  name: string;
}

interface User {
  id: number;
  full_name: string;
  avatar_url?: string;
  username?: string;
}

interface TaskColumn {
  id: number;
  board_id: number;
  name: string;
  position: number;
  color: string;
  is_done_column: boolean;
}

interface Task {
  id: number;
  board_id: number;
  column_id: number;
  title: string;
  description?: string;
  task_type: 'task' | 'bug' | 'feature' | 'research' | 'documentation';
  status: 'todo' | 'in_progress' | 'review' | 'testing' | 'done' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignee_id?: number;
  assignee_name?: string;
  assignee_avatar?: string;
  assignee_ids?: string | null;
  assignee_names?: string | null;
  reporter_name?: string;
  estimated_hours?: number;
  story_points?: number;
  due_date?: string;
  position: number;
  total_hours?: number;
  total_value?: number;
  subtasks_total?: number;
  subtasks_done?: number;
  tags?: string | null;
  collaborators_count?: number;
  collaborators_names?: string | null;
  depends_on_count?: number;
  blocks_count?: number;
  created_at: string;
  updated_at: string;
}

interface Board {
  id: number;
  project_id: number;
  name: string;
  description?: string;
  board_type: string;
  project_name: string;
  columns: TaskColumn[];
  tasks: Task[];
}

const TASKS_FILTERS_STORAGE_KEY = 'tasksPage:filters';

interface PersistedTaskFilters {
  priority?: string;
  taskType?: string;
  assigneeId?: number;
}

function loadPersistedFilters(): PersistedTaskFilters {
  try {
    const raw = localStorage.getItem(TASKS_FILTERS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function savePersistedFilters(filters: PersistedTaskFilters): void {
  try {
    localStorage.setItem(TASKS_FILTERS_STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // localStorage no disponible (modo privado, cuota excedida, etc.) - los filtros
    // simplemente no sobreviven al recargo, sin romper la página.
  }
}

export const TasksPage: React.FC = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [boards, setBoards] = useState<Board[]>([]);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const [selectedProject, setSelectedProject] = useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<'board' | 'my_tasks'>(
    () => (searchParams.get('view') === 'my-tasks' ? 'my_tasks' : 'board')
  );
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [myTasksLoading, setMyTasksLoading] = useState(false);
  const [pendingBoardId, setPendingBoardId] = useState<number | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [boardLoading, setBoardLoading] = useState(false);
  
  // Modal states
  const [isCreateTaskModalOpen, setIsCreateTaskModalOpen] = useState(false);
  const [isCreateBoardModalOpen, setIsCreateBoardModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(null);

  // Filtros del board (persistidos en localStorage para que sobrevivan a un recargo de pagina)
  const [filterPriority, setFilterPriority] = useState<string | undefined>(
    () => loadPersistedFilters().priority
  );
  const [filterTaskType, setFilterTaskType] = useState<string | undefined>(
    () => loadPersistedFilters().taskType
  );
  const [filterAssigneeId, setFilterAssigneeId] = useState<number | undefined>(
    () => loadPersistedFilters().assigneeId
  );

  useEffect(() => {
    savePersistedFilters({
      priority: filterPriority,
      taskType: filterTaskType,
      assigneeId: filterAssigneeId
    });
  }, [filterPriority, filterTaskType, filterAssigneeId]);

  // Edición masiva
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [bulkPriority, setBulkPriority] = useState<string | undefined>(undefined);
  const [bulkAssigneeId, setBulkAssigneeId] = useState<number | undefined>(undefined);
  const [bulkColumnId, setBulkColumnId] = useState<number | undefined>(undefined);

  const [form] = Form.useForm();
  const [boardForm] = Form.useForm();

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadBoards();
    }
  }, [selectedProject]);

  const loadMyTasks = async () => {
    try {
      setMyTasksLoading(true);
      const data = await apiService.get('/tasks/my-tasks');
      setMyTasks(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('🔴 TasksPage: Error loading my tasks:', error);
      message.error('Error al cargar tus tareas asignadas');
    } finally {
      setMyTasksLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === 'my_tasks') {
      loadMyTasks();
    }
  }, [viewMode]);

  const handleInlineMyTaskStatusChange = async (taskId: number, newStatus: string) => {
    try {
      await apiService.put(`/tasks/${taskId}`, { status: newStatus });
      message.success('Estado de tarea actualizado');
      setMyTasks((prev) =>
        newStatus === 'done'
          ? prev.filter((t) => t.id !== taskId)
          : prev.map((t) => (t.id === taskId ? { ...t, status: newStatus as Task['status'] } : t))
      );
      if (selectedBoard) {
        loadBoards();
      }
    } catch {
      message.error('No se pudo actualizar el estado de la tarea');
    }
  };

  const handleStartTaskTimer = async (task: { id: number; title: string; project_id?: number }) => {
    const projectId = task.project_id || selectedProject || selectedBoard?.project_id;
    if (!projectId) {
      navigate(`/time`);
      return;
    }
    try {
      if (typeof (apiService as any).post === 'function') {
        await apiService.post('/time-entries/start-timer', {
          project_id: projectId,
          task_id: task.id,
          description: task.title
        });
        message.success(`Cronómetro iniciado en "${task.title}"`);
        window.dispatchEvent(new CustomEvent('rpa-timer-updated'));
      } else {
        navigate(`/time?project_id=${projectId}&task_id=${task.id}`);
      }
    } catch (error: any) {
      const apiErr = error?.response?.data?.error;
      if (apiErr) {
        message.warning(`${apiErr}. Redirigiendo a Control de Horas...`);
      }
      navigate(`/time?project_id=${projectId}&task_id=${task.id}`);
    }
  };

  useEffect(() => {
    const taskIdParam = searchParams.get('taskId');
    if (!taskIdParam) return;
    const taskId = parseInt(taskIdParam, 10);
    if (isNaN(taskId)) return;

    (async () => {
      try {
        const task = await apiService.getTaskById(taskId);
        setSelectedProject(task.project_id);
        setPendingBoardId(task.board_id);
        setPendingTaskId(taskId);
      } catch (error) {
        console.error('🔴 TasksPage: No se pudo cargar la tarea del link de notificación:', error);
        message.error('No se pudo abrir la tarea indicada');
      }
    })();
    // Deep-link se consume una sola vez al montar; no reaccionar a cambios posteriores de searchParams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (pendingBoardId !== null && boards.some((b) => b.id === pendingBoardId)) {
      loadBoard(pendingBoardId);
      setPendingBoardId(null);
    }
  }, [pendingBoardId, boards]);

  useEffect(() => {
    if (pendingTaskId !== null && selectedBoard) {
      const task = selectedBoard.tasks.find((t) => t.id === pendingTaskId);
      if (task) {
        openEditTaskModal(task);
        setPendingTaskId(null);
        searchParams.delete('taskId');
        setSearchParams(searchParams, { replace: true });
      } else {
        message.error('No se pudo abrir la tarea indicada');
        setPendingTaskId(null);
      }
    }
  }, [pendingTaskId, selectedBoard]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [projectsData, usersData] = await Promise.all([
        apiService.getProjects().catch(err => {
          console.error('🔴 TasksPage: Failed to load projects:', err);
          return [];
        }),
        apiService.get('/auth/users').catch(err => {
          console.error('🔴 TasksPage: Failed to load users:', err);
          return [];
        })
      ]);
      setProjects(projectsData || []);
      setUsers(usersData || []);
      
      // Auto-select first project if available
      if (projectsData && projectsData.length > 0) {
        setSelectedProject(projectsData[0].id);
      }
    } catch (error) {
      console.error('🔴 TasksPage: Error loading initial data:', error);
      const axiosError = error as any;
      let errorMessage = 'Error al cargar datos iniciales';
      
      if (axiosError?.response?.status === 429) {
        errorMessage = 'Demasiadas solicitudes. Por favor, espera un momento e intenta de nuevo.';
      } else if (axiosError?.response?.status >= 500) {
        errorMessage = 'Error del servidor. Por favor, intenta de nuevo más tarde.';
      } else if (axiosError?.code === 'NETWORK_ERROR') {
        errorMessage = 'Error de conexión. Verifica tu conexión a internet.';
      }
      
      message.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const loadBoards = async () => {
    if (!selectedProject) return;
    
    try {
      setBoardLoading(true);
      const boardsData = await apiService.get(`/tasks/boards?project_id=${selectedProject}`);
      setBoards(boardsData || []);
      
      // Auto-select first board if available
      if (boardsData && boardsData.length > 0) {
        if (!pendingBoardId) {
          loadBoard(boardsData[0].id);
        }
      } else {
        setSelectedBoard(null);
      }
    } catch (error) {
      console.error('🔴 TasksPage: Error loading boards:', error);
      const axiosError = error as any;
      
      let errorMessage = "Error al cargar los tableros";
      if (axiosError?.response?.status === 404) {
        errorMessage = "No se encontraron tableros para este proyecto";
      } else if (axiosError?.response?.status === 429) {
        errorMessage = 'Demasiadas solicitudes. Por favor, espera un momento e intenta de nuevo.';
      }
      
      message.error(errorMessage);
      setBoards([]);
      setSelectedBoard(null);
    } finally {
      setBoardLoading(false);
    }
  };

  const loadBoard = async (boardId: number) => {
    try {
      setBoardLoading(true);
      const board = await apiService.get(`/tasks/boards/${boardId}`);
      setSelectedBoard(board);
    } catch (error) {
      console.error('🔴 TasksPage: Error loading board:', error);
      const axiosError = error as any;
      
      let errorMessage = "Error al cargar el tablero";
      if (axiosError?.response?.status === 404) {
        errorMessage = "Tablero no encontrado";
      } else if (axiosError?.response?.status === 429) {
        errorMessage = 'Demasiadas solicitudes. Por favor, espera un momento.';
      }
      
      message.error(errorMessage);
      setSelectedBoard(null);
    } finally {
      setBoardLoading(false);
    }
  };

  const handleCreateBoard = async (values: any) => {
    try {
      await apiService.post('/tasks/boards', {
        ...values,
        project_id: selectedProject
      });
      
      message.success("Tablero creado correctamente");
      setIsCreateBoardModalOpen(false);
      boardForm.resetFields();
      loadBoards();
    } catch (error: any) {
      console.error('Error creating board:', error);
      message.error(error.response?.data?.error || "Error al crear el tablero");
    }
  };

  const handleCreateTask = async (values: any) => {
    try {
      const taskData = {
        ...values,
        board_id: selectedBoard?.id,
        column_id: selectedColumn || selectedBoard?.columns[0]?.id,
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null
      };

      await apiService.post('/tasks', taskData);
      
      message.success('Tarea creada exitosamente');
      setIsCreateTaskModalOpen(false);
      setSelectedColumn(null);
      form.resetFields();
      
      if (selectedBoard) {
        loadBoard(selectedBoard.id);
      }
    } catch (error: any) {
      console.error('Error creating task:', error);
      message.error(error.response?.data?.error || 'Error al crear tarea');
    }
  };

  const handleUpdateTask = async (values: any) => {
    if (!editingTask) return;
    
    try {
      const taskData = {
        ...values,
        due_date: values.due_date ? values.due_date.format('YYYY-MM-DD') : null
      };

      await apiService.put(`/tasks/${editingTask.id}`, taskData);
      
      message.success('Tarea actualizada exitosamente');
      setEditingTask(null);
      form.resetFields();
      
      if (selectedBoard) {
        loadBoard(selectedBoard.id);
      }
    } catch (error: any) {
      console.error('Error updating task:', error);
      message.error(error.response?.data?.error || 'Error al actualizar tarea');
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await apiService.delete(`/tasks/${taskId}`);
      message.success('Tarea eliminada exitosamente');
      
      if (selectedBoard) {
        loadBoard(selectedBoard.id);
      }
    } catch (error: any) {
      console.error('Error deleting task:', error);
      message.error(error.response?.data?.error || 'Error al eliminar tarea');
    }
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      exitSelectionMode();
    } else {
      setSelectionMode(true);
    }
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTaskIds([]);
    setBulkPriority(undefined);
    setBulkAssigneeId(undefined);
    setBulkColumnId(undefined);
  };

  const toggleTaskSelection = (taskId: number) => {
    setSelectedTaskIds((prev) =>
      prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]
    );
  };

  const handleBulkApply = async () => {
    const updates: { priority?: string; assignee_ids?: number[]; column_id?: number } = {};
    if (bulkPriority !== undefined) updates.priority = bulkPriority;
    if (bulkAssigneeId !== undefined) updates.assignee_ids = [bulkAssigneeId];
    if (bulkColumnId !== undefined) updates.column_id = bulkColumnId;

    if (Object.keys(updates).length === 0) {
      message.warning('Elegí al menos un cambio para aplicar');
      return;
    }

    try {
      await apiService.batchUpdateTasks(selectedTaskIds, updates);
      message.success('Tareas actualizadas exitosamente');
      exitSelectionMode();

      if (selectedBoard) {
        loadBoard(selectedBoard.id);
      }
    } catch (error: any) {
      console.error('Error en edición masiva:', error);
      message.error(error.response?.data?.error || 'Error al actualizar tareas');
    }
  };

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination || !selectedBoard) return;

    const { source, destination, draggableId } = result;
    const taskId = parseInt(draggableId);

    // If dropped in same position, do nothing
    if (source.droppableId === destination.droppableId && source.index === destination.index) {
      return;
    }

    const destColumnId = parseInt(destination.droppableId);
    
    // Optimistic update: immediately update the UI
    const updatedBoard = { ...selectedBoard };
    const updatedTasks = [...updatedBoard.tasks];
    
    // Find the task being moved
    const taskIndex = updatedTasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
      const movedTask = { ...updatedTasks[taskIndex] };
      movedTask.column_id = destColumnId;
      
      // Remove task from its current position
      updatedTasks.splice(taskIndex, 1);
      
      // Get tasks in destination column (after removing the moved task)
      const destColumnTasks = updatedTasks.filter(t => t.column_id === destColumnId);
      
      // Find the correct insertion index in the full array
      let insertIndex;
      if (destColumnTasks.length === 0) {
        // If destination column is empty, append to end
        insertIndex = updatedTasks.length;
      } else if (destination.index >= destColumnTasks.length) {
        // If dropping at the end of the column
        const lastTaskIndex = updatedTasks.findIndex(t => t.id === destColumnTasks[destColumnTasks.length - 1].id);
        insertIndex = lastTaskIndex + 1;
      } else {
        // If dropping in the middle, find the task at destination index
        const targetTask = destColumnTasks[destination.index];
        insertIndex = updatedTasks.findIndex(t => t.id === targetTask.id);
      }
      
      // Insert at correct position
      updatedTasks.splice(insertIndex, 0, movedTask);
      
      updatedBoard.tasks = updatedTasks;
      setSelectedBoard(updatedBoard);
    }

    try {
      await apiService.post(`/tasks/${taskId}/move`, {
        column_id: destColumnId,
        position: destination.index + 1
      });

      // Reload board to get the accurate state from server
      setTimeout(() => loadBoard(selectedBoard.id), 100);
    } catch (error: any) {
      console.error('Error moving task:', error);
      message.error(error.response?.data?.error || 'Error al mover tarea');
      // Revert optimistic update on error
      loadBoard(selectedBoard.id);
    }
  };

  const clearFilters = () => {
    setFilterPriority(undefined);
    setFilterTaskType(undefined);
    setFilterAssigneeId(undefined);
  };

  const hasActiveFilters = filterPriority !== undefined || filterTaskType !== undefined || filterAssigneeId !== undefined;

  const openCreateTaskModal = (columnId?: number) => {
    setSelectedColumn(columnId || null);
    setIsCreateTaskModalOpen(true);
  };

  const openEditTaskModal = (task: Task) => {
    setEditingTask(task);
    form.setFieldsValue({
      title: task.title,
      description: task.description,
      task_type: task.task_type,
      priority: task.priority,
      assignee_ids: task.assignee_ids ? task.assignee_ids.split('||').map(Number) : (task.assignee_id ? [task.assignee_id] : []),
      estimated_hours: task.estimated_hours,
      story_points: task.story_points,
      due_date: task.due_date ? dayjs(task.due_date) : null,
      column_id: task.column_id
    });
  };


  const getTaskTypeIcon = (type: string) => {
    switch (type) {
      case 'bug': return '🐛';
      case 'feature': return '✨';
      case 'research': return '🔍';
      case 'documentation': return '📄';
      default: return '📋';
    }
  };

  const renderTaskCard = (task: Task, index: number) => {
    return (
      <Draggable key={task.id} draggableId={task.id.toString()} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            style={{
              ...provided.draggableProps.style,
              marginBottom: 8
            }}
          >
            <Card
              size="small"
              style={{
                backgroundColor: snapshot.isDragging ? 'var(--color-hover)' : 'var(--surface)',
                boxShadow: snapshot.isDragging ? '0 4px 8px rgba(0,0,0,0.2)' : undefined,
                cursor: snapshot.isDragging ? 'grabbing' : 'default',
                position: 'relative'
              }}
            >
              {selectionMode && (
                <Checkbox
                  aria-label={`Seleccionar tarea ${task.title}`}
                  checked={selectedTaskIds.includes(task.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleTaskSelection(task.id)}
                  style={{ position: 'absolute', top: 8, right: 8, zIndex: 20 }}
                />
              )}
              {/* Drag handle area */}
              <div
                {...provided.dragHandleProps}
                style={{
                  position: 'relative',
                  cursor: 'grab',
                  userSelect: 'none'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ marginRight: 8 }}>{getTaskTypeIcon(task.task_type)}</span>
                  <Text strong style={{ flex: 1 }}>{task.title}</Text>
                  <Tag color={getPriorityColor(task.priority)}>
                    {{ critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' }[task.priority]}
                  </Tag>
                </div>

                {task.description && (
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                    {task.description.substring(0, 100)}
                    {task.description.length > 100 ? '...' : ''}
                  </Text>
                )}

                <Space wrap size="small">
                  {task.assignee_names && (() => {
                    const names = task.assignee_names!.split('||');
                    return (
                      <Tooltip title={`Responsables: ${names.join(', ')}`}>
                        <Tag icon={<UserOutlined />}>
                          +{names.length}
                        </Tag>
                      </Tooltip>
                    );
                  })()}

                  {task.due_date && (
                    <Tooltip title={`Vence: ${dayjs(task.due_date).format('DD/MM/YYYY')}`}>
                      <Tag icon={<CalendarOutlined />}>
                        {dayjs(task.due_date).format('DD/MM')}
                      </Tag>
                    </Tooltip>
                  )}

                  {task.estimated_hours && (
                    <Tooltip title={`Estimado: ${task.estimated_hours}h`}>
                      <Tag icon={<ClockCircleOutlined />}>
                        {task.estimated_hours}h
                      </Tag>
                    </Tooltip>
                  )}

                  {task.total_hours && (
                    <Tooltip title={`Trabajado: ${task.total_hours}h - $${task.total_value?.toLocaleString()}`}>
                      <Tag icon={<DollarOutlined />} color="green">
                        ${task.total_value?.toLocaleString()}
                      </Tag>
                    </Tooltip>
                  )}

                  {!!task.subtasks_total && (
                    <Tooltip title={`Subtareas: ${task.subtasks_done}/${task.subtasks_total} completadas`}>
                      <Tag icon={<CheckSquareOutlined />}>
                        {task.subtasks_done}/{task.subtasks_total}
                      </Tag>
                    </Tooltip>
                  )}

                  {task.tags && task.tags.split('||').map((tag) => (
                    <Tag key={tag} color="blue">{tag}</Tag>
                  ))}

                  {!!task.collaborators_count && (
                    <Tooltip title={`Colaboradores: ${(task.collaborators_names || '').split('||').join(', ')}`}>
                      <Tag icon={<TeamOutlined />}>
                        +{task.collaborators_count}
                      </Tag>
                    </Tooltip>
                  )}

                  {((task.depends_on_count || 0) > 0 || (task.blocks_count || 0) > 0) && (
                    <Tooltip
                      title={
                        (task.depends_on_count || 0) > 0 && (task.blocks_count || 0) > 0
                          ? `Depende de ${task.depends_on_count} | Bloquea ${task.blocks_count}`
                          : (task.depends_on_count || 0) > 0
                          ? `Depende de ${task.depends_on_count} tarea(s)`
                          : `Bloquea ${task.blocks_count} tarea(s)`
                      }
                    >
                      <Tag
                        icon={<LinkOutlined />}
                        color={(task.depends_on_count || 0) > 0 ? 'orange' : 'cyan'}
                        data-testid="task-dependency-badge"
                      >
                        {(task.depends_on_count || 0) + (task.blocks_count || 0)}
                      </Tag>
                    </Tooltip>
                  )}
                </Space>
              </div>

              {/* Action buttons - CRITICAL: outside drag handle with pointer events enabled */}
              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: '1px solid var(--color-border)',
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 4,
                  position: 'relative',
                  zIndex: 10,
                  pointerEvents: 'auto',
                  cursor: 'default'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                }}
              >
                <Tooltip title="Iniciar cronómetro / Imputar horas en esta tarea">
                  <Button
                    size="small"
                    type="text"
                    icon={<PlayCircleOutlined />}
                    aria-label="Iniciar timer en tarea"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleStartTaskTimer(task);
                    }}
                    style={{
                      cursor: 'pointer',
                      pointerEvents: 'auto'
                    }}
                  />
                </Tooltip>
                <Tooltip title="Editar">
                  <Button
                    size="small"
                    type="text"
                    icon={<EditOutlined />}
                    aria-label="Editar tarea"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      openEditTaskModal(task);
                    }}
                    style={{
                      cursor: 'pointer',
                      pointerEvents: 'auto'
                    }}
                  />
                </Tooltip>
                <Tooltip title="Eliminar">
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      Modal.confirm({
                        title: '¿Eliminar tarea?',
                        content: 'Esta acción no se puede deshacer.',
                        okText: 'Eliminar',
                        okType: 'danger',
                        cancelText: 'Cancelar',
                        onOk: () => handleDeleteTask(task.id)
                      });
                    }}
                    style={{
                      cursor: 'pointer',
                      pointerEvents: 'auto'
                    }}
                  />
                </Tooltip>
              </div>
            </Card>
          </div>
        )}
      </Draggable>
    );
  };

  const renderColumn = (column: TaskColumn) => {
    const columnTasks = (selectedBoard?.tasks || [])
      .filter(task => task.column_id === column.id)
      .filter(task => !filterPriority || task.priority === filterPriority)
      .filter(task => !filterTaskType || task.task_type === filterTaskType)
      .filter(task => {
        if (filterAssigneeId === undefined) return true;
        const assigneeIds = task.assignee_ids
          ? task.assignee_ids.split('||').map(Number)
          : (task.assignee_id ? [task.assignee_id] : []);
        return assigneeIds.includes(filterAssigneeId);
      });

    return (
      <Col key={column.id} xs={24} sm={12} lg={6} style={{ marginBottom: 16 }}>
        <Card
          title={
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Text strong>{column.name}</Text>
                <Badge count={columnTasks.length} showZero style={{ marginTop: '-2px' }} />
              </div>
              <Button
                type="text"
                icon={<PlusOutlined />}
                size="small"
                onClick={() => openCreateTaskModal(column.id)}
              />
            </div>
          }
          style={{
            backgroundColor: column.color,
            height: '600px',
            overflow: 'auto'
          }}
          styles={{ body: { padding: 8 } }}
        >
          <Droppable droppableId={column.id.toString()}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                style={{
                  minHeight: 500,
                  backgroundColor: snapshot.isDraggingOver ? 'var(--color-info-bg)' : 'transparent',
                  padding: 4,
                  borderRadius: 4
                }}
              >
                {columnTasks.map((task, index) => renderTaskCard(task, index))}
                {provided.placeholder}
                
                {columnTasks.length === 0 && (
                  <EmptyState description="No hay tareas" />
                )}
              </div>
            )}
          </Droppable>
        </Card>
      </Col>
    );
  };

  if (loading) {
    return <LoadingState tip="Cargando tareas…" minHeight={220} />;
  }

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <Title level={2} style={{ marginBottom: 4 }}>Tareas del equipo</Title>
          <Text type="secondary">
            Organiza el trabajo por proyecto, revisa responsables, prioridades y fechas, y registra el tiempo dedicado.
          </Text>
        </div>
        <Segmented
          value={viewMode}
          onChange={(val) => setViewMode(val as 'board' | 'my_tasks')}
          options={[
            { label: 'Tablero por Proyecto', value: 'board', icon: <AppstoreOutlined /> },
            { label: 'Mis Tareas (Todos mis proyectos)', value: 'my_tasks', icon: <UnorderedListOutlined /> }
          ]}
        />
      </div>

      {viewMode === 'my_tasks' ? (
        <Card
          title="Mis tareas activas en todos los proyectos"
          extra={<Button size="small" onClick={loadMyTasks} loading={myTasksLoading}>Actualizar</Button>}
          style={{ marginBottom: 24 }}
        >
          <Table
            rowKey="id"
            loading={myTasksLoading}
            dataSource={myTasks}
            locale={{ emptyText: 'No tienes tareas pendientes asignadas actualmente.' }}
            columns={[
              {
                title: 'Proyecto',
                dataIndex: 'project_name',
                render: (name: string, r: any) => (
                  <Link to={`/projects/${r.project_id}`}><Tag color="processing">{name || `Proyecto #${r.project_id}`}</Tag></Link>
                )
              },
              {
                title: 'Tarea',
                dataIndex: 'title',
                render: (title: string, r: any) => (
                  <Space direction="vertical" size={0}>
                    <Text strong>{getTaskTypeIcon(r.task_type)} {title}</Text>
                    {r.column_name && <Text type="secondary" style={{ fontSize: 12 }}>Columna: {r.column_name}</Text>}
                  </Space>
                )
              },
              {
                title: 'Prioridad',
                dataIndex: 'priority',
                width: 110,
                render: (p: Task['priority']) => (
                  <Tag color={getPriorityColor(p)}>
                    {{ critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' }[p] || p}
                  </Tag>
                )
              },
              {
                title: 'Estado (1-clic)',
                dataIndex: 'status',
                width: 165,
                render: (st: Task['status'], r: any) => (
                  <Select
                    size="small"
                    style={{ width: 150 }}
                    value={st}
                    onChange={(newStatus) => void handleInlineMyTaskStatusChange(r.id, newStatus)}
                    options={[
                      { value: 'todo', label: 'Por Hacer' },
                      { value: 'in_progress', label: 'En Progreso' },
                      { value: 'review', label: 'En Revisión' },
                      { value: 'testing', label: 'En Pruebas' },
                      { value: 'blocked', label: 'Bloqueado' },
                      { value: 'done', label: 'Completada ✓' }
                    ]}
                  />
                )
              },
              {
                title: 'Vencimiento',
                dataIndex: 'due_date',
                width: 120,
                render: (d: string) => d ? dayjs(d).format('DD/MM/YYYY') : <Text type="secondary">-</Text>
              },
              {
                title: 'Horas (Real / Est.)',
                width: 150,
                render: (_: any, r: any) => (
                  <Text>{r.total_hours || 0}h / {r.estimated_hours || 0}h</Text>
                )
              },
              {
                title: 'Acciones',
                width: 240,
                render: (_: any, r: any) => (
                  <Space size="small">
                    <Button
                      size="small"
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      onClick={() => handleStartTaskTimer({ id: r.id, title: r.title, project_id: r.project_id })}
                    >
                      Iniciar Timer
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setSelectedProject(r.project_id);
                        setPendingBoardId(r.board_id);
                        setPendingTaskId(r.id);
                        setViewMode('board');
                      }}
                    >
                      Ver en Kanban
                    </Button>
                  </Space>
                )
              }
            ]}
          />
        </Card>
      ) : null}

      {/* Project and Board Selection */}
      <Card style={{ marginBottom: 24 }}>
        <div className="tasks-toolbar">
          <div className="tasks-toolbar-field">
            <Text strong>Proyecto:</Text>
            <Select
              className="tasks-toolbar-select"
              value={selectedProject}
              onChange={(value) => {
                clearFilters();
                exitSelectionMode();
                setSelectedProject(value);
              }}
              placeholder="Seleccionar proyecto"
            >
              {projects.map(project => (
                <Option key={project.id} value={project.id}>
                  {project.name}
                </Option>
              ))}
            </Select>
          </div>
          
          <div className="tasks-toolbar-field">
            <Text strong>Tablero:</Text>
            <Select
              aria-label="Tablero"
              className="tasks-toolbar-select"
              value={selectedBoard?.id}
              onChange={(value) => {
                clearFilters();
                exitSelectionMode();
                loadBoard(value);
              }}
              placeholder="Seleccionar tablero"
              loading={boardLoading}
            >
              {boards.map(board => (
                <Option key={board.id} value={board.id}>
                  {board.name}
                </Option>
              ))}
            </Select>
          </div>
          
          <div className="tasks-toolbar-actions">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsCreateBoardModalOpen(true)}
              disabled={!selectedProject}
            >
              Nuevo tablero
            </Button>
              
            <Button
              icon={<PlusOutlined />}
              onClick={() => openCreateTaskModal()}
              disabled={!selectedBoard}
            >
              Nueva Tarea
            </Button>

            <Button
              type={selectionMode ? 'primary' : 'default'}
              onClick={toggleSelectionMode}
              disabled={!selectedBoard}
            >
              {selectionMode ? 'Salir de selección' : 'Selección múltiple'}
            </Button>
          </div>
        </div>
      </Card>

      {selectedProject && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Space wrap>
            <Text strong>Proyecto de este tablero:</Text>
            <Link to={`/projects/${selectedProject}`}>{projects.find(project => project.id === selectedProject)?.name || 'Ver proyecto'}</Link>
            <Button type="link" size="small"><Link to={`/projects/${selectedProject}`}>Ficha del proyecto</Link></Button>
            <Button type="link" size="small" icon={<RocketOutlined />}>
              <Link to={`/projects/${selectedProject}?tab=lifecycle`}>Fases y Ciclo de vida</Link>
            </Button>
          </Space>
        </Card>
      )}

      {/* Filtros */}
      {selectedBoard && (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16} align="middle">
            <Col>
              <Text strong>Filtrar:</Text>
            </Col>
            <Col>
              <Select
                aria-label="Filtrar por prioridad"
                placeholder="Prioridad"
                style={{ width: 160 }}
                value={filterPriority}
                onChange={setFilterPriority}
                allowClear
              >
                <Option value="critical">🔴 Crítica</Option>
                <Option value="high">🟠 Alta</Option>
                <Option value="medium">🔵 Media</Option>
                <Option value="low">🟢 Baja</Option>
              </Select>
            </Col>
            <Col>
              <Select
                aria-label="Filtrar por tipo"
                placeholder="Tipo"
                style={{ width: 160 }}
                value={filterTaskType}
                onChange={setFilterTaskType}
                allowClear
              >
                <Option value="task">📋 Tarea</Option>
                <Option value="bug">🐛 Bug</Option>
                <Option value="feature">✨ Feature</Option>
                <Option value="research">🔍 Investigación</Option>
                <Option value="documentation">📄 Documentación</Option>
              </Select>
            </Col>
            <Col>
              <Select
                aria-label="Filtrar por asignado"
                placeholder="Asignado a"
                style={{ width: 180 }}
                value={filterAssigneeId}
                onChange={setFilterAssigneeId}
                allowClear
              >
                {users.map(user => (
                  <Option key={user.id} value={user.id}>{user.full_name}</Option>
                ))}
              </Select>
            </Col>
            {hasActiveFilters && (
              <Col>
                <Button onClick={clearFilters}>Limpiar filtros</Button>
              </Col>
            )}
          </Row>
        </Card>
      )}

      {/* Edición masiva */}
      {selectionMode && selectedTaskIds.length > 0 && (
        <Card size="small" style={{ marginBottom: 16, backgroundColor: 'var(--color-info-bg)' }}>
          <Row gutter={16} align="middle">
            <Col>
              <Text strong>{selectedTaskIds.length} tarea(s) seleccionada(s)</Text>
            </Col>
            <Col>
              <Select
                aria-label="Cambiar prioridad"
                placeholder="Prioridad"
                style={{ width: 160 }}
                value={bulkPriority}
                onChange={setBulkPriority}
                allowClear
              >
                <Option value="critical">🔴 Crítica</Option>
                <Option value="high">🟠 Alta</Option>
                <Option value="medium">🔵 Media</Option>
                <Option value="low">🟢 Baja</Option>
              </Select>
            </Col>
            <Col>
              <Select
                aria-label="Reasignar a"
                placeholder="Reasignar a"
                style={{ width: 180 }}
                value={bulkAssigneeId}
                onChange={setBulkAssigneeId}
                allowClear
              >
                {users.map((user) => (
                  <Option key={user.id} value={user.id}>{user.full_name}</Option>
                ))}
              </Select>
            </Col>
            <Col>
              <Select
                aria-label="Mover a columna"
                placeholder="Mover a columna"
                style={{ width: 180 }}
                value={bulkColumnId}
                onChange={setBulkColumnId}
                allowClear
              >
                {selectedBoard?.columns.map((column) => (
                  <Option key={column.id} value={column.id}>{column.name}</Option>
                ))}
              </Select>
            </Col>
            <Col>
              <Button type="primary" onClick={handleBulkApply}>Aplicar</Button>
            </Col>
            <Col>
              <Button onClick={exitSelectionMode}>Cancelar selección</Button>
            </Col>
          </Row>
        </Card>
      )}

      {/* Kanban Board */}
      {selectedBoard ? (
        <DragDropContext onDragEnd={handleDragEnd}>
          {boardLoading ? (
            <LoadingState tip="Cargando tablero…" minHeight={150} />
          ) : (
            <Row gutter={16}>
              {selectedBoard.columns.map(column => renderColumn(column))}
            </Row>
          )}
        </DragDropContext>
      ) : (
        <Card style={{ textAlign: 'center', padding: 50 }}>
          <EmptyState
            description={
              selectedProject 
                ? "No hay tableros disponibles. Crea uno para comenzar."
                : "Selecciona un proyecto para ver sus tableros"
            }
            action={selectedProject && <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setIsCreateBoardModalOpen(true)}
              style={{ marginTop: 16 }}
            >
              Crear primer tablero
            </Button>}
          />
        </Card>
      )}

      {/* Create Board Modal */}
      <Modal
        title="Crear tablero"
        open={isCreateBoardModalOpen}
        onCancel={() => {
          setIsCreateBoardModalOpen(false);
          boardForm.resetFields();
        }}
        footer={null}
      >
        <Form
          form={boardForm}
          layout="vertical"
          onFinish={handleCreateBoard}
        >
          <Form.Item
            name="name"
            label="Nombre del tablero"
            rules={[{ required: true, message: 'Ingrese el nombre del board' }]}
          >
            <Input placeholder="Ej: Sprint 1, Desarrollo, Testing..." />
          </Form.Item>
          
          <Form.Item name="description" label="Descripción">
            <TextArea rows={3} placeholder="Descripción opcional del board..." />
          </Form.Item>
          
          <Form.Item name="board_type" label="Tipo de tablero" initialValue="kanban">
            <Select>
              <Option value="kanban">Kanban</Option>
              <Option value="scrum">Scrum</Option>
              <Option value="custom">Personalizado</Option>
            </Select>
          </Form.Item>
          
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                Crear tablero
              </Button>
              <Button onClick={() => {
                setIsCreateBoardModalOpen(false);
                boardForm.resetFields();
              }}>
                Cancelar
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* Create/Edit Task Modal */}
      <Modal
        title={editingTask ? 'Editar Tarea' : 'Nueva Tarea'}
        open={isCreateTaskModalOpen || !!editingTask}
        onCancel={() => {
          setIsCreateTaskModalOpen(false);
          setEditingTask(null);
          setSelectedColumn(null);
          form.resetFields();
        }}
        footer={null}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={editingTask ? handleUpdateTask : handleCreateTask}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                name="title"
                label="Título"
                rules={[{ required: true, message: 'Ingrese el título de la tarea' }]}
              >
                <Input placeholder="Título de la tarea..." />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="task_type" label="Tipo" initialValue="task">
                <Select>
                  <Option value="task">📋 Tarea</Option>
                  <Option value="bug">🐛 Bug</Option>
                  <Option value="feature">✨ Feature</Option>
                  <Option value="research">🔍 Investigación</Option>
                  <Option value="documentation">📄 Documentación</Option>
                </Select>
              </Form.Item>
            </Col>
            
            <Col span={8}>
              <Form.Item name="priority" label="Prioridad" initialValue="medium">
                <Select>
                  <Option value="critical">🔴 Crítica</Option>
                  <Option value="high">🟠 Alta</Option>
                  <Option value="medium">🔵 Media</Option>
                  <Option value="low">🟢 Baja</Option>
                </Select>
              </Form.Item>
            </Col>

            {editingTask && (
              <Col span={8}>
                <Form.Item name="column_id" label="Columna">
                  <Select>
                    {selectedBoard?.columns.map(column => (
                      <Option key={column.id} value={column.id}>
                        {column.name}
                      </Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
            )}
          </Row>
          
          <Form.Item name="description" label="Descripción">
            <TextArea rows={4} placeholder="Describe la tarea..." />
          </Form.Item>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="assignee_ids" label="Responsables">
                <Select mode="multiple" placeholder="Seleccionar responsables" allowClear optionFilterProp="children">
                  {users.map(user => (
                    <Option key={user.id} value={user.id}>
                      {user.full_name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
            
            <Col span={12}>
              <Form.Item name="due_date" label="Fecha límite">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="estimated_hours" label="Horas estimadas">
                <Input type="number" step="0.5" placeholder="Ej: 8" />
              </Form.Item>
            </Col>
            
            <Col span={12}>
              <Form.Item name="story_points" label="Puntos de esfuerzo">
                <Input type="number" placeholder="Ej: 5" />
              </Form.Item>
            </Col>
          </Row>

          {editingTask && (
            <>
              <Divider />
              <TaskTagsEditor
                taskId={editingTask.id}
                onChange={() => selectedBoard && loadBoard(selectedBoard.id)}
              />
              <Divider />
              <TaskCollaboratorsEditor
                taskId={editingTask.id}
                users={users}
                onChange={() => selectedBoard && loadBoard(selectedBoard.id)}
              />
              <Divider />
              <TaskSubtasksChecklist
                taskId={editingTask.id}
                onChange={() => selectedBoard && loadBoard(selectedBoard.id)}
              />
              <Divider />
              <TaskDependenciesEditor
                taskId={editingTask.id}
                availableTasks={selectedBoard?.tasks || []}
                onChange={() => selectedBoard && loadBoard(selectedBoard.id)}
              />
              <Divider />
              <CommentsThread
                entityType="task"
                entityId={editingTask.id}
              />
            </>
          )}

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                {editingTask ? 'Actualizar' : 'Crear'} Tarea
              </Button>
              <Button onClick={() => {
                setIsCreateTaskModalOpen(false);
                setEditingTask(null);
                setSelectedColumn(null);
                form.resetFields();
              }}>
                Cancelar
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};
