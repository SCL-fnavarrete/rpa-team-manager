import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Progress, Skeleton, Space, Table, Tag, Typography, theme } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FundOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ProjectOutlined,
  RiseOutlined,
  FallOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useAuthStore } from '@/store/authStore';
import { apiService } from '@/services/api';
import { Project, ProjectStatusLabels, PriorityLabels } from '@/types/project';
import { RoleLabels } from '@/types/auth';
import { EmptyState, InlineErrorState } from '@/components/common';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
type FinancialAlert = { project_name?: string; alert_type?: string; alert_level?: string };

export const DashboardPage: React.FC = () => {
  const { token } = theme.useToken();
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roiDashboard, setRoiDashboard] = useState<any>(null);
  const [roiLoading, setRoiLoading] = useState(false);
  const [myTasksCount, setMyTasksCount] = useState<number>(0);
  const [myWeekHours, setMyWeekHours] = useState<number>(0);
  const [myWeekStatus, setMyWeekStatus] = useState<string>('draft');
  const [activeTimerEntry, setActiveTimerEntry] = useState<any>(null);

  const loadROIDashboard = useCallback(async () => {
    try {
      setRoiLoading(true);
      setRoiDashboard(await apiService.getROIDashboard());
    } catch (loadError) {
      console.error('Failed to load ROI dashboard:', loadError);
    } finally {
      setRoiLoading(false);
    }
  }, []);

  const loadPersonalSummary = useCallback(async () => {
    try {
      const d = dayjs();
      const day = d.day();
      const diff = day === 0 ? -6 : 1 - day;
      const weekStart = d.add(diff, 'day').format('YYYY-MM-DD');

      const [tasksRes, weekRes, activeRes] = await Promise.allSettled([
        apiService.get?.('/tasks/my-tasks?limit=100') ?? Promise.resolve([]),
        apiService.getTimesheetWeek?.(weekStart) ?? Promise.resolve(null),
        apiService.get?.('/time-entries/active') ?? Promise.resolve(null)
      ]);

      if (tasksRes.status === 'fulfilled' && tasksRes.value) {
        const list = Array.isArray(tasksRes.value) ? tasksRes.value : (tasksRes.value?.data || []);
        const pending = list.filter((t: any) => t.status !== 'done' && t.status !== 'completed');
        setMyTasksCount(pending.length);
      }
      if (weekRes.status === 'fulfilled' && weekRes.value) {
        setMyWeekHours(Number(weekRes.value.totals?.total_hours || 0));
        setMyWeekStatus(weekRes.value.period?.status || 'draft');
      }
      if (activeRes.status === 'fulfilled') {
        setActiveTimerEntry(activeRes.value || null);
      }
    } catch {
      // Non-blocking personal summary
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setProjects(await apiService.getProjects());
      void loadPersonalSummary();
      if (user?.role === 'team_lead') await loadROIDashboard();
    } catch (loadError: any) {
      setError(loadError.response?.data?.error || 'No se pudo cargar el resumen. Intenta nuevamente.');
    } finally {
      setLoading(false);
    }
  }, [loadPersonalSummary, loadROIDashboard, user?.role]);

  useEffect(() => { void loadDashboardData(); }, [loadDashboardData]);

  const stats = useMemo(() => {
    const active = projects.filter((project) => project.status === 'active').length;
    const completed = projects.filter((project) => project.status === 'completed').length;
    const totalTasks = projects.reduce((sum, project) => sum + (project.total_tasks || 0), 0);
    const completedTasks = projects.reduce((sum, project) => sum + (project.completed_tasks || 0), 0);
    const hours = projects.reduce((sum, project) => sum + (project.total_hours_logged || 0), 0);
    const overdue = projects.filter((project) => project.end_date && project.status !== 'completed' && dayjs(project.end_date).isBefore(dayjs(), 'day'));
    return { total: projects.length, active, completed, overdue, hours, completion: totalTasks ? Math.round(completedTasks / totalTasks * 100) : 0 };
  }, [projects]);

  const activeAlerts: FinancialAlert[] = roiDashboard?.active_alerts || [];
  const roleName = user ? RoleLabels[user.role] : 'Equipo';
  const firstName = user?.full_name?.split(' ')[0] || 'equipo';
  const greeting = new Intl.DateTimeFormat('es-CL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const attentionCount = stats.overdue.length + activeAlerts.length;

  const columns: ColumnsType<Project> = [
    {
      title: 'Proyecto', dataIndex: 'name', key: 'name',
      render: (name: string, record) => <div className="dashboard-project-name"><Text strong>{name}</Text><Text type="secondary">{record.description?.trim() || 'Sin descripción registrada'}</Text></div>
    },
    {
      title: 'Estado', dataIndex: 'status', key: 'status',
      render: (status: string) => <Tag className={`status-tag status-${status}`}>{ProjectStatusLabels[status as keyof typeof ProjectStatusLabels] || status}</Tag>
    },
    {
      title: 'Prioridad', dataIndex: 'priority', key: 'priority',
      render: (priority: string) => <span className={`priority-label priority-${priority}`}><span />{PriorityLabels[priority as keyof typeof PriorityLabels] || priority}</span>
    },
    {
      title: 'Avance', dataIndex: 'progress_percentage', key: 'progress', width: 176,
      render: (progress: number) => <div className="dashboard-progress"><Progress percent={progress || 0} showInfo={false} strokeColor="var(--color-primary)" trailColor="var(--color-border)" /><Text>{progress || 0}%</Text></div>
    },
    { title: 'Horas', dataIndex: 'total_hours_logged', key: 'hours', align: 'right', render: (hours: number) => `${(hours || 0).toFixed(1)} h` }
  ];

  return (
    <main className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <Text className="dashboard-date">{greeting}</Text>
          <Title level={1}>Hola, {firstName}</Title>
          <Paragraph>Este es el estado de tu oficina de proyectos y lo que merece atención hoy.</Paragraph>
        </div>
        <div className="dashboard-welcome-aside">
          <span className="dashboard-role-icon"><FundOutlined /></span>
          <div><Text className="dashboard-aside-label">VISTA DE TRABAJO</Text><Text strong>{roleName}</Text></div>
        </div>
      </section>

      {error && <InlineErrorState className="dashboard-error" title="No fue posible actualizar el resumen" description={error} onRetry={() => void loadDashboardData()} />}

      <Card
        style={{ marginBottom: 20, borderColor: activeTimerEntry ? token.colorSuccess : token.colorBorderSecondary }}
        styles={{ body: { padding: '16px 20px' } }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Text className="section-kicker" style={{ display: 'block' }}>MI ESPACIO DE TRABAJO · ESTA SEMANA</Text>
            <Space size="large" wrap style={{ marginTop: 4 }}>
              <div>
                <Text type="secondary">Mis horas esta semana: </Text>
                <Text strong style={{ fontSize: 16 }}>{myWeekHours.toFixed(1)} / 40 h</Text>{' '}
                <Tag color={myWeekStatus === 'approved' ? 'green' : myWeekStatus === 'submitted' ? 'blue' : myWeekStatus === 'rejected' ? 'red' : 'default'}>
                  {myWeekStatus === 'approved' ? 'Aprobada' : myWeekStatus === 'submitted' ? 'Enviada' : myWeekStatus === 'rejected' ? 'Rechazada' : 'Borrador'}
                </Tag>
              </div>
              <div>
                <Text type="secondary">Mis tareas pendientes: </Text>
                <Tag color={myTasksCount > 0 ? 'processing' : 'success'}>{myTasksCount} activas</Tag>
              </div>
              {activeTimerEntry && (
                <Tag color="green" icon={<PlayCircleOutlined />}>
                  Cronómetro en curso: {activeTimerEntry.project_name || `Proyecto #${activeTimerEntry.project_id}`}
                </Tag>
              )}
            </Space>
          </div>
          <Space wrap>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => navigate('/tasks?view=my-tasks')}>
              Mis Tareas ({myTasksCount})
            </Button>
            <Button icon={<ClockCircleOutlined />} onClick={() => navigate('/time')}>
              {activeTimerEntry ? 'Ver Cronómetro / Horas' : 'Imputar Horas de la Semana'}
            </Button>
          </Space>
        </div>
      </Card>

      <section className="dashboard-overview" aria-label="Indicadores del portafolio">
        <div className="overview-intro"><Text className="section-kicker">PORTAFOLIO</Text><Title level={4}>Panorama general</Title></div>
        <div className="overview-metrics">
          <div className="overview-metric"><span className="metric-icon metric-icon-blue"><ProjectOutlined /></span><div><Text type="secondary">Proyectos activos</Text><div className="metric-value">{loading ? <Skeleton.Input active size="small" /> : stats.active}<span>de {loading ? '—' : stats.total}</span></div></div></div>
          <div className="overview-metric"><span className="metric-icon metric-icon-green"><CheckCircleOutlined /></span><div><Text type="secondary">Tareas completadas</Text><div className="metric-value">{loading ? <Skeleton.Input active size="small" /> : `${stats.completion}%`}<span>del total</span></div></div></div>
          <div className="overview-metric"><span className="metric-icon metric-icon-amber"><ClockCircleOutlined /></span><div><Text type="secondary">Horas registradas</Text><div className="metric-value">{loading ? <Skeleton.Input active size="small" /> : stats.hours.toFixed(1)}<span>horas</span></div></div></div>
        </div>
      </section>

      <div className="dashboard-main-grid">
        <section className="dashboard-panel dashboard-projects-panel">
          <header className="dashboard-panel-header">
            <div><Text className="section-kicker">SEGUIMIENTO</Text><Title level={4}>Proyectos recientes</Title><Text type="secondary">Accede a la ficha y continúa desde el último estado.</Text></div>
            <Button type="link" onClick={() => navigate('/projects')}>Ver portafolio <ArrowRightOutlined /></Button>
          </header>
          {loading ? <div className="dashboard-table-loading"><Skeleton active paragraph={{ rows: 4 }} /></div> : projects.length ? <Table<Project>
            columns={columns} dataSource={[...projects].slice(0, 6)} rowKey="id" pagination={false} size="middle"
            onRow={(record) => ({ onClick: () => navigate(`/projects/${record.id}`), tabIndex: 0, onKeyDown: (event) => { if (event.key === 'Enter') navigate(`/projects/${record.id}`); } })}
            locale={{ emptyText: 'Aún no hay proyectos para mostrar' }}
          /> : <EmptyState description="Aún no hay proyectos en el portafolio" action={<Button type="primary" onClick={() => navigate('/projects')}>Ir al portafolio</Button>} />}
        </section>

        <aside className="dashboard-side-column">
          <section className={`attention-panel${attentionCount ? ' has-attention' : ''}`}>
            <header className="attention-heading"><span className="attention-icon"><ExclamationCircleOutlined /></span><div><Text className="section-kicker">CENTRO DE ATENCIÓN</Text><Title level={4}>Requiere atención</Title></div></header>
            {loading || roiLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : attentionCount ? <div className="attention-list">
              {stats.overdue.slice(0, 3).map((project) => <button className="attention-item" key={`overdue-${project.id}`} onClick={() => navigate(`/projects/${project.id}`)}><span className="attention-item-marker marker-red" /><span className="attention-item-copy"><Text strong>{project.name}</Text><Text type="secondary">Fecha de término vencida</Text></span><ArrowRightOutlined /></button>)}
              {activeAlerts.slice(0, Math.max(0, 4 - stats.overdue.length)).map((alert, index) => <button className="attention-item" key={`alert-${index}`} onClick={() => navigate('/priorities')}><span className={`attention-item-marker ${alert.alert_level === 'critical' ? 'marker-red' : 'marker-amber'}`} /><span className="attention-item-copy"><Text strong>{alert.project_name || 'Alerta financiera'}</Text><Text type="secondary">{alert.alert_type === 'cost_overrun' ? 'Revisar desviación de costos' : 'Revisar rentabilidad del proyecto'}</Text></span><ArrowRightOutlined /></button>)}
              <Button type="link" onClick={() => navigate(user?.role === 'team_lead' ? '/priorities' : '/pmo')}>Revisar alertas <ArrowRightOutlined /></Button>
            </div> : <div className="attention-clear"><CheckCircleOutlined /><div><Text strong>Todo en orden</Text><Text type="secondary">No hay alertas críticas en los datos disponibles.</Text></div></div>}
          </section>

          {user?.role === 'team_lead' && <section className="finance-summary">
            <header><span className="finance-icon"><DollarOutlined /></span><Text className="section-kicker">RENDIMIENTO FINANCIERO</Text></header>
            {roiLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : <>
              <div className="finance-primary"><Text type="secondary">Precio de venta configurado · CLP</Text><Title level={3}>{new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(roiDashboard?.overall_metrics?.total_revenue || 0)}</Title></div>
              <div className="finance-secondary"><div><Text type="secondary">ROI promedio estimado</Text><Text strong>{Math.round(roiDashboard?.overall_metrics?.avg_roi || 0)}%</Text></div><div><Text type="secondary">Resultado estimado · CLP</Text><Text strong className={(roiDashboard?.overall_metrics?.total_profit || 0) >= 0 ? 'value-positive' : 'value-negative'}>{new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(roiDashboard?.overall_metrics?.total_profit || 0)}</Text></div></div>
              <Button type="link" onClick={() => navigate('/billing')}>Abrir finanzas <ArrowRightOutlined /></Button>
            </>}
          </section>}

          <section className="dashboard-shortcuts"><Text className="section-kicker">ACCESOS RÁPIDOS</Text><Space wrap>
            {(user?.role === 'team_lead' || user?.role === 'rpa_operations') && <Button icon={<FundOutlined />} onClick={() => navigate('/pmo')}>Centro PMO</Button>}
            {user?.role === 'team_lead' && <Button icon={<PlusOutlined />} type="primary" onClick={() => navigate('/projects')}>Nuevo proyecto</Button>}
            {(user?.role === 'rpa_developer' || user?.role === 'rpa_operations') && <Button icon={<CheckCircleOutlined />} type="primary" onClick={() => navigate('/tasks')}>Mis tareas</Button>}
            <Button icon={<TeamOutlined />} onClick={() => navigate('/time')}>Registrar tiempo</Button>
          </Space></section>
        </aside>
      </div>
      {user?.role === 'team_lead' && roiDashboard?.overall_metrics && <div className="dashboard-finance-footnote"><span>{roiDashboard?.overall_metrics?.avg_roi >= 0 ? <RiseOutlined /> : <FallOutlined />}</span> El costo usa horas aprobadas disponibles o una proyección si aún faltan; estas cifras no representan facturación ni pagos recibidos.</div>}
    </main>
  );
};
