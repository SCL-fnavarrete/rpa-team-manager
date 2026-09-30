import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Col, DatePicker, Empty, Input, Row, Select, Space, Typography, App } from 'antd';
import { PlusOutlined, SearchOutlined, ProjectOutlined, ExclamationCircleOutlined, FileTextOutlined, FilterOutlined, CalculatorOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { ProjectCard } from '@/components/projects/ProjectCard';
import { CreateProjectModal } from '@/components/projects/CreateProjectModal';
import { CreateProjectWizard } from '@/components/projects/CreateProjectWizard';
import { QuoteUploadModal } from '@/components/projects/QuoteUploadModal';
import { EmptyState, ErrorState, LoadingState } from '@/components/common';
import { useProjectStore } from '@/store/projectStore';
import { useAuthStore } from '@/store/authStore';
import { apiService } from '@/services/api';
import { Project } from '@/types/project';
import { ProjectHealth } from '@/types/projectHealth';

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
type HealthFilter = 'all' | ProjectHealth['semaphore'];

export const ProjectsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [clientFilter, setClientFilter] = useState<number | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState<number | 'all'>('all');
  const [commercialStageFilter, setCommercialStageFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [period, setPeriod] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [sortOrder, setSortOrder] = useState('updated');
  const [clients, setClients] = useState<Array<{ id: number; name: string }>>([]);
  const [projectHealth, setProjectHealth] = useState<Record<number, ProjectHealth>>({});
  const [healthLoading, setHealthLoading] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [wizardVisible, setWizardVisible] = useState(false);
  const [quoteUploadModalVisible, setQuoteUploadModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const { projects, isLoading, error, fetchProjects, deleteProject, clearError } = useProjectStore();
  const { user, hasPermission } = useAuthStore();
  const { message, modal } = App.useApp();

  useEffect(() => { void fetchProjects(); }, [fetchProjects]);
  useEffect(() => {
    let active = true;
    apiService.request<{ data?: Array<{ id: number; name: string }> } | Array<{ id: number; name: string }>>({ url: '/clients' })
      .then((response) => { if (active) setClients(Array.isArray(response) ? response : response?.data || []); })
      .catch(() => { if (active) setClients([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (user?.role !== 'team_lead') { setProjectHealth({}); return; }
    let active = true;
    setHealthLoading(true);
    Promise.all(projects.map(async (project) => {
      try { return [project.id, await apiService.getProjectHealth(project.id)] as const; }
      catch { return null; }
    })).then((results) => {
      if (active) setProjectHealth(Object.fromEntries(results.filter((result): result is NonNullable<typeof result> => result !== null)));
    }).finally(() => { if (active) setHealthLoading(false); });
    return () => { active = false; };
  }, [projects, user?.role]);

  const canCreateProject = user?.role === 'team_lead' || hasPermission('projects:create') || hasPermission('projects:*');
  const availableClients = useMemo(() => {
    const clientMap = new Map(clients.map((client) => [client.id, client]));
    projects.forEach((project) => {
      if (project.client_id && project.client_name && !clientMap.has(project.client_id)) {
        clientMap.set(project.client_id, { id: project.client_id, name: project.client_name });
      }
    });
    return Array.from(clientMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [clients, projects]);
  const filteredProjects = useMemo(() => {
    const search = searchTerm.trim().toLocaleLowerCase('es-CL');
    const [from, to] = period || [null, null];
    return projects.filter((project) => {
      const haystack = [project.name, project.description, project.client_name, project.assigned_to_name]
        .filter(Boolean).join(' ').toLocaleLowerCase('es-CL');
      const matchesSearch = !search || haystack.includes(search);
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || project.priority === priorityFilter;
      const matchesStage = commercialStageFilter === 'all' || (project.commercial_stage || 'approved') === commercialStageFilter;
      const matchesClient = clientFilter === 'all' || project.client_id === clientFilter;
      const matchesOwner = ownerFilter === 'all' || project.assigned_to === ownerFilter;
      const matchesHealth = healthFilter === 'all' || projectHealth[project.id]?.semaphore === healthFilter;
      const start = project.start_date ? dayjs(project.start_date) : null;
      const end = project.end_date ? dayjs(project.end_date) : null;
      const matchesPeriod = (!from && !to) || Boolean((start && (!to || !start.isAfter(to, 'day'))) && (end && (!from || !end.isBefore(from, 'day'))));
      return matchesSearch && matchesStatus && matchesPriority && matchesStage && matchesClient && matchesOwner && matchesHealth && matchesPeriod;
    }).sort((a, b) => {
      if (sortOrder === 'name') return a.name.localeCompare(b.name, 'es');
      if (sortOrder === 'end_date') return (a.end_date || '9999').localeCompare(b.end_date || '9999');
      if (sortOrder === 'progress') return b.progress_percentage - a.progress_percentage;
      return (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at);
    });
  }, [projects, searchTerm, statusFilter, priorityFilter, commercialStageFilter, clientFilter, ownerFilter, healthFilter, projectHealth, period, sortOrder]);

  const hasFilters = Boolean(searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || clientFilter !== 'all' || ownerFilter !== 'all' || commercialStageFilter !== 'all' || healthFilter !== 'all' || period);
  const resetFilters = () => { setSearchTerm(''); setStatusFilter('all'); setPriorityFilter('all'); setClientFilter('all'); setOwnerFilter('all'); setCommercialStageFilter('all'); setHealthFilter('all'); setPeriod(null); };
  const handleDeleteProject = (project: Project) => modal.confirm({
    title: 'Eliminar proyecto', icon: <ExclamationCircleOutlined />, content: `¿Quieres eliminar “${project.name}”? Esta acción no se puede deshacer.`, okText: 'Eliminar', okType: 'danger', cancelText: 'Cancelar',
    onOk: async () => { try { await deleteProject(project.id); message.success('Proyecto eliminado'); } catch (deleteError: any) { message.error(deleteError?.response?.data?.error || 'No se pudo eliminar el proyecto'); } }
  });
  const handleQuoteUploadSuccess = (project: any) => { void fetchProjects(); message.success('Proyecto creado exitosamente desde cotización'); if (project?.id) navigate(`/projects/${project.id}`); };

  if (error) return <main className="projects-page projects-page-state"><ErrorState title="No fue posible cargar los proyectos" description={error} action={<Space><Button size="small" onClick={clearError}>Cerrar</Button><Button type="primary" size="small" onClick={() => void fetchProjects()}>Reintentar</Button></Space>} /></main>;

  return (
    <main className="projects-page">
      <section className="projects-heading">
        <div><Text className="section-kicker">REPOSITORIO Y SEGUIMIENTO</Text><Title level={1}><ProjectOutlined /> Portafolio de proyectos</Title><Text type="secondary">Busca y revisa clientes, responsables, etapas, avance y fechas de cada iniciativa.</Text></div>
        {canCreateProject && <Space wrap className="projects-heading-actions"><Button icon={<CalculatorOutlined />} onClick={() => navigate('/cotizador')}>Cotizador & Levantamiento</Button><Button icon={<FileTextOutlined />} onClick={() => setQuoteUploadModalVisible(true)}>Crear desde cotización</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingProject(null); setWizardVisible(true); }}>Nuevo proyecto</Button></Space>}
      </section>
      <section className="projects-toolbar" aria-label="Buscar y filtrar proyectos">
        <Row gutter={[10, 10]} align="middle">
          <Col xs={24} md={12} lg={8}><Input aria-label="Buscar proyectos" placeholder="Buscar por proyecto, cliente o responsable" value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} allowClear prefix={<SearchOutlined />} /></Col>
          <Col xs={12} md={6} lg={4}><Select aria-label="Filtrar por cliente" style={{ width: '100%' }} value={clientFilter} onChange={setClientFilter} showSearch optionFilterProp="label" options={[{ label: 'Todos los clientes', value: 'all' }, ...availableClients.map((client) => ({ label: client.name, value: client.id }))]} /></Col>
          <Col xs={12} md={6} lg={4}><Select aria-label="Filtrar por responsable" style={{ width: '100%' }} value={ownerFilter} onChange={setOwnerFilter} showSearch optionFilterProp="label" options={[{ label: 'Todos los responsables', value: 'all' }, ...Array.from(new Map(projects.filter((project) => project.assigned_to && project.assigned_to_name).map((project) => [project.assigned_to, { label: project.assigned_to_name!, value: project.assigned_to! }])).values())]} /></Col>
          <Col xs={12} md={6} lg={4}><Select aria-label="Filtrar por estado" style={{ width: '100%' }} value={statusFilter} onChange={setStatusFilter} options={[{ label: 'Todos los estados', value: 'all' }, { label: 'En ejecución', value: 'active' }, { label: 'En pausa', value: 'on_hold' }, { label: 'Completado', value: 'completed' }, { label: 'Cancelado', value: 'cancelled' }]} /></Col>
          <Col xs={12} md={6} lg={4}><Select aria-label="Filtrar por etapa" style={{ width: '100%' }} value={commercialStageFilter} onChange={setCommercialStageFilter} options={[{ label: 'Todas las etapas', value: 'all' }, { label: 'En cotización', value: 'quoting' }, { label: 'Aprobado', value: 'approved' }, { label: 'Oportunidad perdida', value: 'lost' }]} /></Col>
          {user?.role === 'team_lead' && <Col xs={12} md={6} lg={4}><Select aria-label="Filtrar por salud del proyecto" style={{ width: '100%' }} value={healthFilter} onChange={setHealthFilter} loading={healthLoading} options={[{ label: 'Cualquier salud', value: 'all' }, { label: 'En curso', value: 'green' }, { label: 'En riesgo', value: 'yellow' }, { label: 'Desviado', value: 'red' }, { label: 'Datos insuficientes', value: 'gray' }]} /></Col>}
          <Col xs={24} md={12} lg={8}><RangePicker aria-label="Filtrar por periodo del proyecto" style={{ width: '100%' }} value={period} onChange={(value) => setPeriod(value as [Dayjs | null, Dayjs | null] | null)} placeholder={['Inicio desde', 'Término hasta']} /></Col>
          <Col xs={12} md={6} lg={5}><Select aria-label="Ordenar proyectos" style={{ width: '100%' }} value={sortOrder} onChange={setSortOrder} options={[{ label: 'Actualizados recientemente', value: 'updated' }, { label: 'Nombre A-Z', value: 'name' }, { label: 'Término más próximo', value: 'end_date' }, { label: 'Mayor avance', value: 'progress' }]} /></Col>
          <Col xs={12} md={6} lg={3}><Select aria-label="Filtrar por prioridad" style={{ width: '100%' }} value={priorityFilter} onChange={setPriorityFilter} options={[{ label: 'Toda prioridad', value: 'all' }, { label: 'Crítica', value: 'critical' }, { label: 'Alta', value: 'high' }, { label: 'Media', value: 'medium' }, { label: 'Baja', value: 'low' }]} /></Col>
        </Row>
        <div className="projects-toolbar-footer"><Text type="secondary"><FilterOutlined /> {filteredProjects.length} de {projects.length} {filteredProjects.length === 1 ? 'proyecto' : 'proyectos'}</Text>{hasFilters && <Button type="link" size="small" onClick={resetFilters}>Limpiar filtros</Button>}</div>
      </section>
      {isLoading && projects.length === 0 ? <LoadingState tip="Cargando proyectos…" minHeight={200} /> : filteredProjects.length === 0 ? (hasFilters ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Ningún proyecto coincide con estos filtros"><Button onClick={resetFilters}>Limpiar filtros</Button></Empty> : <EmptyState description="Todavía no hay proyectos en el portafolio" action={canCreateProject && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingProject(null); setWizardVisible(true); }}>Crear el primer proyecto</Button>} />) : (
        <Row gutter={[16, 16]} className="projects-grid">
          {filteredProjects.map((project) => <Col xs={24} md={12} xl={8} key={project.id}><ProjectCard project={project} health={projectHealth[project.id]} onEdit={(item) => { setEditingProject(item); setEditModalVisible(true); }} onDelete={handleDeleteProject} onView={(item) => navigate(`/projects/${item.id}`)} onClick={(item) => navigate(`/projects/${item.id}`)} /></Col>)}
        </Row>
      )}
      <CreateProjectWizard visible={wizardVisible} onCancel={() => setWizardVisible(false)} onSuccess={() => { void fetchProjects(); }} />
      <CreateProjectModal visible={editModalVisible} onCancel={() => { setEditModalVisible(false); setEditingProject(null); }} onSuccess={() => { void fetchProjects(); }} editProject={editingProject} />
      <QuoteUploadModal visible={quoteUploadModalVisible} onCancel={() => setQuoteUploadModalVisible(false)} onSuccess={handleQuoteUploadSuccess} />
    </main>
  );
};
