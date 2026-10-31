import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Row,
  Col,
  Button,
  Typography,
  Card,
  Tag,
  Progress,
  Descriptions,
  Space,
  Statistic,
  List,
  Avatar,
  Empty,
  Alert,
  Breadcrumb,
  Tabs,
  Segmented,
  App
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ProjectOutlined,
  HomeOutlined,
  FolderOutlined,
  PictureOutlined,
  FundOutlined,
  RobotOutlined,
  RocketOutlined,
  MessageOutlined,
  FileDoneOutlined
} from '@ant-design/icons';
import { ProjectROICard } from '@/components/projects/ProjectROICard';
import { ProjectHealthCard } from '@/components/projects/ProjectHealthCard';
import { ActivityTimeline } from '@/components/activity/ActivityTimeline';
import { CommentsThread } from '@/components/comments/CommentsThread';
import { ProjectPMOView } from '@/components/projects/ProjectPMOView';
import { ProjectMilestonesAndLog } from '@/components/projects/ProjectMilestonesAndLog';
import { ProjectMLAnalytics } from '@/components/projects/ProjectMLAnalytics';
import { CreateProjectModal } from '@/components/projects/CreateProjectModal';
import { ProjectClosureReportModal } from '@/components/projects/ProjectClosureReportModal';
import { hasClientApproval } from '@/utils/saleRealization';
import { FileManager, EvidenceGallery } from '@/components/files';
import { ProjectLifecyclePage } from '@/pages/lifecycle/ProjectLifecyclePage';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
import { Project, ProjectStatusLabels, PriorityLabels } from '@/types/project';
import { apiService } from '@/services/api';
import { getProjectStatusColor } from '@/utils';
import { ProjectHealth } from '@/types/projectHealth';
import { ProjectCommercialSection } from '@/components/projects/ProjectCommercialSection';
import { ErrorState, LoadingState } from '@/components/common';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const projectTabOrder = ['overview', 'commercial', 'execution', 'billing', 'files', 'collaboration'];

export const ProjectDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [health, setHealth] = useState<ProjectHealth | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [closureOpen, setClosureOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [commercialTab, setCommercialTab] = useState('commercial');
  const [executionSubView, setExecutionSubView] = useState<'lifecycle' | 'milestones-log' | 'pmo'>('lifecycle');
  const [filesSubTab, setFilesSubTab] = useState<string>('doc_pdd');
  const [collaborationSubView, setCollaborationSubView] = useState<'comments' | 'ai-analytics'>('comments');
  
  const { getProject } = useProjectStore();
  const { user } = useAuthStore();
  const { message, modal } = App.useApp();

  const loadProjectData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Try direct API call first, then fallback to store
      let projectData;
      try {
        projectData = await apiService.getProject(parseInt(id!));
      } catch (apiError) {
        console.warn('Direct project API failed; trying project store:', apiError);
        projectData = await getProject(parseInt(id!));
      }
      
      setProject(projectData);

      if (user?.role === 'team_lead') {
        try {
          setHealth(await apiService.getProjectHealth(projectData.id));
        } catch (healthError) {
          console.warn('Project health is not available:', healthError);
          setHealth(null);
        }
      } else {
        setHealth(null);
      }
      
      // Load project tasks 
      try {
        const tasks = await apiService.request({ url: `/tasks/project/${id}?limit=5` });
        setTasks(tasks || []);
      } catch (error) {
        console.error('Failed to load project tasks:', error);
        setTasks([]);
      }
    } catch (error) {
      console.error('Failed to load project:', error);
    } finally {
      setLoading(false);
    }
  }, [getProject, id, user?.role]);

  useEffect(() => {
    if (id) void loadProjectData();
  }, [id, loadProjectData]);

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (!requestedTab) return;
    if (requestedTab === 'lifecycle' || requestedTab === 'milestones-log' || requestedTab === 'pmo') {
      setActiveTab('execution');
      setExecutionSubView(requestedTab);
    } else if (requestedTab === 'evidence') {
      setActiveTab('files');
      setFilesSubTab('evidence');
    } else if (requestedTab === 'comments' || requestedTab === 'ai-analytics') {
      setActiveTab('collaboration');
      setCollaborationSubView(requestedTab);
    } else if (['overview', 'commercial', 'execution', 'billing', 'files', 'collaboration'].includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);


  const getTaskStatusColor = (status: string) => {
    const colors = {
      done: 'success',
      in_progress: 'processing',
      review: 'warning',
      testing: 'warning',
      todo: 'default',
      blocked: 'error'
    };
    return colors[status as keyof typeof colors] || 'default';
  };

  const handleTaskClick = (_task: any) => {
    // Navigate to Tasks module with project filter
    navigate(`/tasks?project=${project?.id}`);
  };

  const handleViewAllTasks = () => {
    // Navigate to Tasks module with project filter
    navigate(`/tasks?project=${project?.id}`);
  };

  const handleEdit = () => {
    setEditModalVisible(true);
  };

  const handleEditSuccess = (_updatedProject?: Project) => {
    setEditModalVisible(false);
    // Reload project data to show updated information
    loadProjectData();
  };

  const handleDelete = () => {
    modal.confirm({
      title: 'Eliminar proyecto',
      icon: <ExclamationCircleOutlined />,
      content: `¿Quieres eliminar “${project?.name}”? Esta acción no se puede deshacer.`,
      okText: 'Eliminar',
      okType: 'danger',
      cancelText: 'Cancelar',
      onOk: async () => {
        try {
          const { deleteProject } = useProjectStore.getState();
          await deleteProject(project!.id);
          message.success('Proyecto eliminado');
          navigate('/projects');
        } catch (error: any) {
          const errorMessage = error?.response?.data?.error || 'No se pudo eliminar el proyecto';
          message.error(errorMessage);
        }
      }
    });
  };

  const handleBack = () => {
    navigate('/projects');
  };

  if (loading) {
    return <LoadingState tip="Cargando ficha del proyecto…" minHeight={240} />;
  }

  if (!project) {
    return (
      <ErrorState
        title="No se encontró el proyecto"
        description="El proyecto no existe o no tienes permiso para consultarlo."
        action={<Button onClick={handleBack}>Volver al portafolio</Button>}
      />
    );
  }

  const completedTasks = project.completed_tasks ?? 0;
  const totalTasks = project.total_tasks ?? 0;
  const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const remainingDays = project.end_date ? dayjs(project.end_date).startOf('day').diff(dayjs().startOf('day'), 'day') : null;
  const dateFormatter = new Intl.DateTimeFormat('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
  const projectScheduleLabel = project.start_date && project.end_date
    ? `${dateFormatter.format(dayjs(project.start_date).toDate())} — ${dateFormatter.format(dayjs(project.end_date).toDate())}`
    : project.start_date ? `Inicio ${dateFormatter.format(dayjs(project.start_date).toDate())}`
      : project.end_date ? `Término ${dateFormatter.format(dayjs(project.end_date).toDate())}` : 'Fechas por definir';
  const healthLabels: Record<ProjectHealth['semaphore'], string> = {
    green: 'En curso', yellow: 'En riesgo', red: 'Desviado', gray: 'Salud sin datos'
  };
  const statusLabel = ({ active: 'En ejecución', planning: 'En planificación', on_hold: 'En pausa', completed: 'Completado', cancelled: 'Cancelado' } as Record<string, string>)[project.status] || ProjectStatusLabels[project.status as keyof typeof ProjectStatusLabels] || project.status;
  const priorityLabel = ({ critical: 'Crítica', high: 'Alta', medium: 'Media', low: 'Baja' } as Record<string, string>)[project.priority] || PriorityLabels[project.priority as keyof typeof PriorityLabels] || project.priority;

  return (
    <main className="project-detail-page">
      <Breadcrumb className="project-detail-breadcrumb" items={[
        { title: <HomeOutlined /> },
        { title: <button onClick={handleBack} className="breadcrumb-link">Portafolio</button> },
        { title: project.name }
      ]} />

      <section className="project-hero">
        <div className="project-hero-main">
          <Button className="project-back-button" icon={<ArrowLeftOutlined />} onClick={handleBack}>Volver al portafolio</Button>
          <div className="project-hero-title-row">
            <div className="project-hero-title-block">
              <div className="project-status-line">
                <Tag color={getProjectStatusColor(project.status)}>{statusLabel}</Tag>
                {project.status === 'completed' && (
                  project.financial_closed_at ? (
                    <Tag color="cyan">Cierre financiero completado</Tag>
                  ) : (
                    <Tag color="gold" style={{ cursor: 'pointer' }} onClick={() => setActiveTab('commercial')}>
                      Entrega aceptada · Cobranza pendiente
                    </Tag>
                  )
                )}
                {user?.role === 'team_lead' && hasClientApproval(project) && (
                  <Button size="small" icon={<FileDoneOutlined />} onClick={() => setClosureOpen(true)}>Informe de cierre</Button>
                )}
                <span className={`project-priority-pill priority-${project.priority}`}><span />Prioridad {priorityLabel.toLowerCase()}</span>
                {health && <span className={`project-health-pill health-${health.semaphore}`}><span />{healthLabels[health.semaphore]}</span>}
              </div>
              <Title level={1}>{project.name}</Title>
              <div className="project-hero-meta">
                {project.client_name && <span><UserOutlined />{project.client_name}</span>}
                {project.client_contact_name && <span><UserOutlined />{project.client_contact_name}</span>}
                {project.opportunity_source && <span>{project.opportunity_source === 'sales' ? `Comercial · ${project.sales_rep_name || 'Sin asignar'}` : 'Contacto directo'}</span>}
                <span><CalendarOutlined />{projectScheduleLabel}</span>
                {project.assigned_to_name && <span><UserOutlined />{project.assigned_to_name}</span>}
                <span><ClockCircleOutlined />{project.total_hours_logged?.toFixed(1) || '0.0'} h registradas</span>
              </div>
            </div>
            {user?.role === 'team_lead' && <Space className="project-hero-actions">
              <Button type="primary" icon={<EditOutlined />} onClick={handleEdit}>Editar proyecto</Button>
              <Button danger icon={<DeleteOutlined />} onClick={handleDelete}>Eliminar</Button>
            </Space>}
          </div>
          {project.description && <Paragraph className="project-hero-description">{project.description}</Paragraph>}
        </div>

        <div className="project-hero-progress">
          <div className="project-hero-progress-top"><span>AVANCE DEL PROYECTO</span><strong>{progressPercentage}%</strong></div>
          <Progress percent={progressPercentage} showInfo={false} strokeColor="var(--color-success)" trailColor="rgba(255,255,255,.17)" />
          <div className="project-hero-progress-bottom"><span>{completedTasks} de {totalTasks} tareas completadas</span><span>{remainingDays === null ? 'Plazo por definir' : remainingDays < 0 ? `Vencido hace ${Math.abs(remainingDays)} días` : remainingDays === 0 ? 'Vence hoy' : `${remainingDays} días restantes`}</span></div>
        </div>
      </section>

      <section className="project-kpi-strip">
        <div className="project-kpi"><span className="project-kpi-icon"><ProjectOutlined /></span><div><Text type="secondary">Tareas</Text><strong>{completedTasks}<span> / {totalTasks}</span></strong></div></div>
        <div className="project-kpi"><span className="project-kpi-icon"><ClockCircleOutlined /></span><div><Text type="secondary">Horas registradas</Text><strong>{(project.total_hours_logged || 0).toFixed(1)}<span> h</span></strong></div></div>
        <div className="project-kpi"><span className="project-kpi-icon"><CalendarOutlined /></span><div><Text type="secondary">Próximo paso</Text><strong className="project-kpi-next">{tasks.find((task) => task.status !== 'done' && task.status !== 'completed')?.title || 'Revisar hitos'}</strong></div></div>
        {user?.role === 'team_lead' && <div className="project-kpi"><span className="project-kpi-icon"><DollarOutlined /></span><div><Text type="secondary">Salud del proyecto</Text><strong className="project-kpi-health">{health ? healthLabels[health.semaphore] : 'Pendiente de datos'}</strong></div></div>}
      </section>

      <section className="project-detail-workspace">
        <div className="project-section-intro"><div><Text className="section-kicker">ESPACIO DE TRABAJO DEL PROYECTO</Text><Title level={4}>Información y seguimiento</Title></div><Text type="secondary">{totalTasks} tareas · actualizado al {dateFormatter.format(new Date())}</Text></div>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          size="middle"
          className="project-detail-tabs"
          items={[
            {
              key: 'overview',
              label: (
                <span>
                  <ProjectOutlined />
                  Resumen
                </span>
              ),
              children: (
                <Row gutter={[24, 24]}>
                  {/* Left Column - Project Info */}
                  <Col xs={24} lg={16}>
                    {/* Project Overview */}
                    <Card className="project-info-card" title="Contexto del proyecto" style={{ marginBottom: '18px' }}>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Descriptions column={1} size="small">
                            <Descriptions.Item 
                              label={<><UserOutlined /> Responsable</>}
                            >
                              <Space>
                                <Avatar size="small" icon={<UserOutlined />} />
                                <Button type="link" style={{ padding: 0 }} onClick={() => { setCommercialTab('capacity'); setActiveTab('commercial'); }}>{project.assigned_to_name || 'Sin asignar'}</Button>
                              </Space>
                            </Descriptions.Item>
                            
                            <Descriptions.Item 
                              label={<><CalendarOutlined /> Fecha de inicio</>}
                            >
                              {project.start_date ? dateFormatter.format(dayjs(project.start_date).toDate()) : 'Por definir'}
                            </Descriptions.Item>
                            
                            <Descriptions.Item 
                              label={<><CalendarOutlined /> Fecha de término</>}
                            >
                              {project.end_date ? dateFormatter.format(dayjs(project.end_date).toDate()) : 'Por definir'}
                            </Descriptions.Item>
                            
                            {user?.role === 'team_lead' && (
                              <Descriptions.Item
                                label={<><DollarOutlined /> Presupuesto</>}
                              >
                                {project.budget ? `$${project.budget.toLocaleString('es-CL')}` : 'Por definir'}
                              </Descriptions.Item>
                            )}
                          </Descriptions>
                        </Col>
                        
                        <Col span={12}>
                          <div className="project-progress-summary"><Text type="secondary">Progreso de tareas</Text><Progress type="circle" percent={progressPercentage} format={(percent) => `${percent}%`} size={104} strokeColor="var(--color-primary)" trailColor="var(--color-border)" /><Text type="secondary">{completedTasks} de {totalTasks} completadas</Text></div>
                        </Col>
                      </Row>
                    </Card>

                    {/* Tasks */}
                    <Card 
                      title="Actividad de trabajo"
                      extra={
                        <Button 
                          type="link" 
                          onClick={handleViewAllTasks}
                          icon={<ProjectOutlined />}
                        >
                          Ver tablero completo
                        </Button>
                      }
                      style={{ marginBottom: '24px' }}
                    >
                      {tasks.length > 0 ? (
                        <List
                          dataSource={tasks}
                          renderItem={task => (
                            <List.Item 
                              style={{ cursor: 'pointer' }}
                              onClick={() => handleTaskClick(task)}
                            >
                              <List.Item.Meta
                                avatar={
                                  <Avatar 
                                    size="small" 
                                    icon={task.status === 'done' ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
                                    style={{ 
                                      backgroundColor: task.status === 'done' ? 'var(--color-success)' : 'var(--color-info)' 
                                    }}
                                  />
                                }
                                title={
                                  <Space>
                                    <Text strong={task.status !== 'done'} delete={task.status === 'done'}>
                                      {task.title}
                                    </Text>
                                    <Tag color={getTaskStatusColor(task.status)}>
                                      {task.status === 'done' || task.status === 'completed' ? 'Completada' : task.status === 'in_progress' ? 'En curso' : task.status === 'blocked' ? 'Bloqueada' : task.status === 'review' ? 'En revisión' : task.status === 'testing' ? 'En pruebas' : 'Pendiente'}
                                    </Tag>
                                  </Space>
                                }
                                description={
                                  <Space split={<span style={{ color: 'var(--color-border)' }}>•</span>}>
                                    <Text type="secondary">{task.assignee_name || 'Sin asignar'}</Text>
                                    {task.due_date && (
                                      <Text type="secondary">Vence: {dateFormatter.format(dayjs(task.due_date).toDate())}</Text>
                                    )}
                                    {task.board_name && <Text type="secondary">Tablero: {task.board_name}</Text>}
                                  </Space>
                                }
                              />
                            </List.Item>
                          )}
                        />
                      ) : (
                        <Empty 
                          description="Todavía no hay tareas vinculadas a este proyecto"
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          style={{ padding: '40px 0' }}
                        >
                          <Button 
                            type="primary" 
                            onClick={handleViewAllTasks}
                            icon={<ProjectOutlined />}
                          >
                            Abrir tareas
                          </Button>
                        </Empty>
                      )}
                      {tasks.length > 0 && (
                        <div style={{ textAlign: 'center', marginTop: '16px' }}>
                          <Button 
                            type="primary" 
                            onClick={handleViewAllTasks}
                            icon={<ProjectOutlined />}
                          >
                            Abrir tablero de tareas
                          </Button>
                        </div>
                      )}
                    </Card>
                  </Col>

                  {/* Right Column - Stats & ROI */}
                  <Col xs={24} lg={8}>
                    {/* Project Stats */}
                    <Card title="Indicadores de ejecución" style={{ marginBottom: '18px' }}>
                      <Row gutter={[16, 16]}>
                        <Col span={12}>
                          <Statistic
                            title="Tareas totales"
                            value={totalTasks}
                            prefix={<ProjectOutlined />}
                            valueStyle={{ color: 'var(--color-info)' }}
                          />
                        </Col>
                        <Col span={12}>
                          <Statistic
                            title="Completadas"
                            value={completedTasks}
                            prefix={<CheckCircleOutlined />}
                            valueStyle={{ color: 'var(--color-success)' }}
                          />
                        </Col>
                        <Col span={12}>
                          <Statistic
                            title="Horas registradas"
                            value={project.total_hours_logged || 0}
                            suffix="h"
                            prefix={<ClockCircleOutlined />}
                            valueStyle={{ color: 'var(--color-warning)' }}
                          />
                        </Col>
                        <Col span={12}>
                          <Statistic
                            title="Avance"
                            value={progressPercentage}
                            suffix="%"
                            valueStyle={{ color: progressPercentage > 80 ? 'var(--color-success)' : 'var(--color-info)' }}
                          />
                        </Col>
                      </Row>
                    </Card>

                    {/* Financial Metrics (ROI) - Only for team_lead */}
                    {user?.role === 'team_lead' && (
                      <ProjectROICard
                        projectId={project.id}
                        projectName={project.name}
                        assignedUserId={project.assigned_to}
                      />
                    )}
                    {user?.role === 'team_lead' && (
                      <ProjectHealthCard projectId={project.id} />
                    )}

                    <Card className="project-activity-card" title="Últimos movimientos" style={{ marginTop: '18px' }}>
                      <ActivityTimeline projectId={project.id} />
                    </Card>

                    {/* PMO Quick Actions */}
                    <Card className="project-pmo-shortcuts" title="Seguimiento PMO" style={{ marginTop: '18px' }}>
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Button 
                          type="primary" 
                          icon={<FundOutlined />}
                          onClick={() => navigate(`/pmo?project=${project.id}`)}
                          block
                        >
                          Abrir centro PMO
                        </Button>
                        <Button 
                          icon={<ProjectOutlined />}
                          onClick={() => { setExecutionSubView('pmo'); setActiveTab('execution'); }}
                          block
                        >
                          Ver indicadores PMO
                        </Button>
                        <Button 
                          icon={<CalendarOutlined />}
                          onClick={() => navigate(`/pmo/gantt/${project.id}`)}
                          block
                        >
                          Abrir cronograma de hitos
                        </Button>
                      </Space>
                    </Card>

                    {/* Timeline Info */}
                    {(project.start_date && project.end_date) && (
                      <Card title="Calendario del proyecto" style={{ marginTop: '18px' }}>
                        <Space direction="vertical" style={{ width: '100%' }}>
                          <div>
                            <Text strong>Duración:</Text>
                            <Text style={{ float: 'right' }}>
                              {dayjs(project.end_date).diff(dayjs(project.start_date), 'days')} días
                            </Text>
                          </div>
                          <div>
                            <Text strong>Tiempo restante:</Text>
                            <Text style={{ float: 'right' }}>
                              {dayjs(project.end_date).diff(dayjs(), 'days')} días
                            </Text>
                          </div>
                          {dayjs().isAfter(dayjs(project.end_date)) && (
                            <Alert
                              message="El plazo del proyecto venció"
                              type="error"
                              showIcon
                            />
                          )}
                        </Space>
                      </Card>
                    )}
                  </Col>
                </Row>
              )
            },
            {
              key: 'commercial',
              label: <span><DollarOutlined /> Comercial · Contratos · Equipo</span>,
              children: <ProjectCommercialSection project={project} user={user || undefined} onRefresh={loadProjectData} initialTab={commercialTab} onTabChange={setCommercialTab} />
            },
            {
              key: 'execution',
              label: (
                <span>
                  <RocketOutlined />
                  Planificación y Ejecución
                </span>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
                    <Segmented
                      value={executionSubView}
                      onChange={(val) => setExecutionSubView(val as 'lifecycle' | 'milestones-log' | 'pmo')}
                      options={[
                        { label: 'Ciclo de vida RPA', value: 'lifecycle', icon: <RocketOutlined /> },
                        { label: 'Hitos y bitácora', value: 'milestones-log', icon: <FundOutlined /> },
                        { label: 'Indicadores PMO y Gantt', value: 'pmo', icon: <CalendarOutlined /> }
                      ]}
                    />
                    <Button type="default" icon={<ProjectOutlined />} onClick={handleViewAllTasks}>
                      Ir al Tablero Kanban
                    </Button>
                  </div>
                  {executionSubView === 'lifecycle' && <ProjectLifecyclePage projectId={project.id} />}
                  {executionSubView === 'milestones-log' && (
                    <ProjectMilestonesAndLog
                      projectId={project.id}
                      canWriteLog={
                        user?.role === 'team_lead' ||
                        project.assigned_to === user?.id ||
                        project.created_by === user?.id
                      }
                    />
                  )}
                  {executionSubView === 'pmo' && (
                    <ProjectPMOView
                      projectId={project.id}
                      projectName={project.name}
                      projectStatus={project.status}
                      startDate={project.start_date}
                      endDate={project.end_date}
                    />
                  )}
                </div>
              )
            },
            {
              key: 'billing',
              label: <span><DollarOutlined /> Finanzas y cobranza</span>,
              children: <ProjectCommercialSection project={project} user={user || undefined} onRefresh={loadProjectData} initialTab="billing" />
            },
            {
              key: 'files',
              label: <span><FolderOutlined /> Documentos y Evidencias</span>,
              children: (
                <div style={{ padding: '8px 0' }}>
                  <Tabs
                    activeKey={filesSubTab}
                    onChange={setFilesSubTab}
                    items={[
                      { key: 'doc_pdd', label: 'PDD', children: <FileManager entity_type="project" entity_id={project.id} title="PDD" association_type="doc_pdd" multiple maxFiles={20} /> },
                      { key: 'doc_technical', label: 'Documentación técnica', children: <FileManager entity_type="project" entity_id={project.id} title="Documentación técnica" association_type="doc_technical" multiple maxFiles={20} /> },
                      { key: 'doc_contract', label: 'Contrato/OC', children: <FileManager entity_type="project" entity_id={project.id} title="Contrato/OC" association_type="doc_contract" multiple maxFiles={20} /> },
                      { key: 'doc_other', label: 'Otros archivos', children: <FileManager entity_type="project" entity_id={project.id} title="Otro" association_type="doc_other" multiple maxFiles={20} /> },
                      {
                        key: 'evidence',
                        label: <span><PictureOutlined /> Galería de Evidencias</span>,
                        children: (
                          <EvidenceGallery
                            entity_type="project"
                            entity_id={project.id}
                            entity_name={project.name}
                            title={`Evidencias · ${project.name}`}
                            showUpload={true}
                            maxImages={100}
                          />
                        )
                      }
                    ]}
                  />
                </div>
              )
            },
            {
              key: 'collaboration',
              label: (
                <span>
                  <MessageOutlined />
                  IA y Colaboración
                </span>
              ),
              children: (
                <div style={{ padding: '8px 0' }}>
                  <div style={{ marginBottom: 16 }}>
                    <Segmented
                      value={collaborationSubView}
                      onChange={(val) => setCollaborationSubView(val as 'comments' | 'ai-analytics')}
                      options={[
                        { label: 'Comentarios del proyecto', value: 'comments', icon: <MessageOutlined /> },
                        { label: 'Revisor IA (Skill)', value: 'ai-analytics', icon: <RobotOutlined /> }
                      ]}
                    />
                  </div>
                  {collaborationSubView === 'comments' ? (
                    <div style={{ maxWidth: '720px' }}>
                      <CommentsThread
                        entityType="project"
                        entityId={project.id}
                      />
                    </div>
                  ) : (
                    <ProjectMLAnalytics
                      projectId={project.id}
                      projectName={project.name}
                    />
                  )}
                </div>
              )
            }
          ].sort((first, second) => projectTabOrder.indexOf(first.key) - projectTabOrder.indexOf(second.key))}
        />
      </section>

      {/* Edit Project Modal */}
      <CreateProjectModal
        visible={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onSuccess={handleEditSuccess}
        editProject={project}
      />

      {user?.role === 'team_lead' && (
        <ProjectClosureReportModal projectId={project.id} open={closureOpen} onClose={() => setClosureOpen(false)} />
      )}
    </main>
  );
};
