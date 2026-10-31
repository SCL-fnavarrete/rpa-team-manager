import React, { useState, useEffect, useCallback } from 'react';
import {
  Card,
  Button,
  Table,
  Typography,
  Space,
  Select,
  Input,
  Tag,
  message,
  Row,
  Col,
  Statistic,
  Tabs,
  InputNumber,
  Popconfirm,
  Alert,
  Checkbox,
  Tooltip,
  theme
} from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  CopyOutlined,
  LeftOutlined,
  RightOutlined,
  SendOutlined
} from '@ant-design/icons';
import { Link, useSearchParams } from 'react-router-dom';
import { apiService } from '@/services/api';
import {
  SaveWeekEntryInput,
  TimesheetWeek,
  TimesheetPeriod,
  EffectivenessMetrics,
  PendingReminders
} from '@/types/timesheet';
import { useAuthStore } from '@/store/authStore';
import dayjs from 'dayjs';
import 'dayjs/locale/es';

const { Title, Text } = Typography;
const { Option } = Select;

interface Project {
  id: number;
  name: string;
}

interface TaskOption {
  id: number;
  title: string;
  project_id?: number;
}

interface ActiveTimer {
  id: number;
  project_id: number;
  task_id?: number;
  description?: string;
  date: string;
  start_time: string;
  project_name?: string;
  task_title?: string;
}

function mondayOf(date: dayjs.Dayjs): string {
  const weekday = date.day(); // 0 = domingo ... 6 = sábado
  const diffFromMonday = weekday === 0 ? 6 : weekday - 1;
  return date.subtract(diffFromMonday, 'day').format('YYYY-MM-DD');
}

const formatReminderDate = (date: string) => new Intl.DateTimeFormat('es-CL', {
  day: '2-digit', month: '2-digit', year: 'numeric'
}).format(new Date(`${date.slice(0, 10)}T00:00:00`));

const WeekGrid: React.FC<{
  projects: Project[];
  tasksByProject: Record<number, TaskOption[]>;
  ensureProjectTasks: (projectId: number) => void;
  refreshSignal: number;
}> = ({ projects, tasksByProject, ensureProjectTasks, refreshSignal }) => {
  const [weekStart, setWeekStart] = useState(mondayOf(dayjs()));
  const [week, setWeek] = useState<TimesheetWeek | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftByDay, setDraftByDay] = useState<Record<string, SaveWeekEntryInput[]>>({});

  const seedDraftFromWeek = (data: TimesheetWeek) => {
    const draft: Record<string, SaveWeekEntryInput[]> = {};
    const projectIds = new Set<number>();
    data.days.forEach(day => {
      draft[day.date] = day.entries.map(e => {
        if (e.project_id) projectIds.add(e.project_id);
        return {
          id: e.id, project_id: e.project_id, task_id: e.task_id, description: e.description,
          date: e.date, hours: e.hours, is_billable: e.is_billable
        };
      });
    });
    setDraftByDay(draft);
    projectIds.forEach(pid => ensureProjectTasks(pid));
  };

  const loadWeek = useCallback(async () => {
    try {
      setLoading(true);
      const data: TimesheetWeek = await apiService.getTimesheetWeek(weekStart);
      setWeek(data);
      seedDraftFromWeek(data);
    } catch (error) {
      console.error('Error loading timesheet week:', error);
      message.error('Error al cargar la semana');
    } finally {
      setLoading(false);
    }
    // refreshSignal cambia cuando el timer arranca o se detiene: obliga a recargar la semana
    // para que el borrador no quede desfasado respecto de la BD.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart, refreshSignal]);

  useEffect(() => { loadWeek(); }, [loadWeek]);

  const isLocked = week?.period?.status === 'submitted' || week?.period?.status === 'approved';

  const addRow = (date: string) => {
    if (isLocked || !projects[0]) return;
    ensureProjectTasks(projects[0].id);
    setDraftByDay(prev => ({
      ...prev,
      [date]: [...(prev[date] || []), { project_id: projects[0].id, task_id: null, date, hours: 1, is_billable: true }]
    }));
  };

  const updateRow = (date: string, index: number, patch: Partial<SaveWeekEntryInput>) => {
    setDraftByDay(prev => {
      const rows = [...(prev[date] || [])];
      rows[index] = { ...rows[index], ...patch };
      return { ...prev, [date]: rows };
    });
  };

  const removeRow = (date: string, index: number) => {
    setDraftByDay(prev => {
      const rows = [...(prev[date] || [])];
      rows.splice(index, 1);
      return { ...prev, [date]: rows };
    });
  };

  const repeatEntryMonToFri = (sourceEntry: SaveWeekEntryInput) => {
    if (isLocked || !week?.days) return;
    const workdays = week.days.slice(0, 5); // Lunes a Viernes
    setDraftByDay((prev) => {
      const next = { ...prev };
      workdays.forEach((d) => {
        const currentRows = [...(next[d.date] || [])];
        const exists = currentRows.some(
          (r) => r.project_id === sourceEntry.project_id && (r.task_id ?? null) === (sourceEntry.task_id ?? null)
        );
        if (!exists) {
          currentRows.push({
            project_id: sourceEntry.project_id,
            task_id: sourceEntry.task_id ?? null,
            date: d.date,
            hours: sourceEntry.hours || 1,
            is_billable: sourceEntry.is_billable !== false,
            description: sourceEntry.description || ''
          });
        }
        next[d.date] = currentRows;
      });
      return next;
    });
    message.success('Registro replicado de Lunes a Viernes en tu borrador');
  };

  const handleCopyPreviousWeek = async () => {
    if (isLocked || !week?.days) return;
    try {
      const prevStart = mondayOf(dayjs(weekStart).subtract(7, 'day'));
      const prevWeek: TimesheetWeek = await apiService.getTimesheetWeek(prevStart);
      if (!prevWeek?.days || prevWeek.days.every((d) => !d.entries?.length)) {
        message.info('La semana anterior no tiene registros para copiar');
        return;
      }
      const nextDraft = { ...draftByDay };
      let copiedCount = 0;
      week.days.forEach((currDay, dayIndex) => {
        const prevDay = prevWeek.days[dayIndex];
        if (!prevDay?.entries?.length) return;
        const currRows = [...(nextDraft[currDay.date] || [])];
        prevDay.entries.forEach((pe) => {
          if (pe.project_id) ensureProjectTasks(pe.project_id);
          const exists = currRows.some(
            (r) => r.project_id === pe.project_id && (r.task_id ?? null) === (pe.task_id ?? null)
          );
          if (!exists) {
            currRows.push({
              project_id: pe.project_id,
              task_id: pe.task_id ?? null,
              date: currDay.date,
              hours: pe.hours || 1,
              is_billable: pe.is_billable !== false,
              description: pe.description || ''
            });
            copiedCount += 1;
          }
        });
        nextDraft[currDay.date] = currRows;
      });
      setDraftByDay(nextDraft);
      if (copiedCount > 0) {
        message.success(`Se copiaron ${copiedCount} registro(s) de la semana anterior`);
      } else {
        message.info('Los proyectos y tareas de la semana anterior ya están en esta semana');
      }
    } catch {
      message.error('No se pudo copiar la semana anterior');
    }
  };

  const handleSave = async (): Promise<boolean> => {
    try {
      setSaving(true);
      const allEntries = Object.values(draftByDay).flat().filter(e => e.hours > 0);
      const updated = await apiService.saveTimesheetWeek(weekStart, allEntries);
      setWeek(updated);
      seedDraftFromWeek(updated);
      message.success('Semana guardada');
      return true;
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Error al guardar la semana');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    const saved = await handleSave();
    if (!saved) {
      return;
    }
    try {
      await apiService.submitTimesheetWeek(weekStart);
      message.success('Semana enviada a aprobación');
      await loadWeek();
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Error al enviar la semana');
    }
  };

  const weekTotal = Object.values(draftByDay).flat().reduce((sum, e) => sum + (e.hours || 0), 0);

  return (
    <div>
      <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button aria-label="Semana anterior" icon={<LeftOutlined />} onClick={() => setWeekStart(mondayOf(dayjs(weekStart).subtract(7, 'day')))} />
          <Text strong>Semana del {dayjs(weekStart).format('DD/MM/YYYY')}</Text>
          <Button aria-label="Semana siguiente" icon={<RightOutlined />} onClick={() => setWeekStart(mondayOf(dayjs(weekStart).add(7, 'day')))} />
          {!isLocked && (
            <Tooltip title="Copia en 1 clic los proyectos y tareas registrados en la semana anterior">
              <Button size="small" icon={<CopyOutlined />} onClick={() => void handleCopyPreviousWeek()}>
                Copiar semana anterior
              </Button>
            </Tooltip>
          )}
        </Space>
        <Space>
          <Statistic title="Total de la semana" value={weekTotal} suffix="h" precision={2} />
          {week?.period && (
            <Tag color={
              week.period.status === 'approved' ? 'green' :
              week.period.status === 'submitted' ? 'blue' :
              week.period.status === 'rejected' ? 'red' : 'default'
            }>
              {({ approved: 'Aprobada', submitted: 'En revisión', rejected: 'Rechazada', draft: 'Borrador', open: 'Abierta' } as Record<string, string>)[week.period.status] || 'Borrador'}
            </Tag>
          )}
        </Space>
      </Row>

      {week?.period?.status === 'rejected' && (
        <Alert
          type="warning"
          showIcon
          message="Semana rechazada"
          description={week.period.rejection_reason}
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {(week?.days || []).map(day => (
          <Col xs={24} md={12} lg={8} key={day.date}>
            <Card
              size="small"
              title={dayjs(day.date).locale('es').format('dddd DD/MM')}
              extra={<Text type="secondary">{(draftByDay[day.date] || []).reduce((s, e) => s + (e.hours || 0), 0)}h</Text>}
            >
              {(draftByDay[day.date] || []).map((entry, idx) => (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <Row gutter={4} align="middle">
                    <Col span={10}>
                      <Select
                        size="small"
                        aria-label={`Proyecto para registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                        style={{ width: '100%' }}
                        value={entry.project_id}
                        disabled={isLocked}
                        onChange={(v) => {
                          ensureProjectTasks(v);
                          updateRow(day.date, idx, { project_id: v, task_id: null });
                        }}
                      >
                        {projects.map(p => <Option key={p.id} value={p.id}>{p.name}</Option>)}
                      </Select>
                    </Col>
                    <Col span={6}>
                      <InputNumber
                        size="small"
                        aria-label={`Horas para registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                        min={0.25}
                        max={24}
                        step={0.25}
                        style={{ width: '100%' }}
                        disabled={isLocked}
                        value={entry.hours}
                        onChange={(v) => updateRow(day.date, idx, { hours: v || 0 })}
                      />
                    </Col>
                    <Col span={5} style={{ textAlign: 'center' }}>
                      <Checkbox
                        aria-label={`Facturable, registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                        checked={entry.is_billable !== false}
                        disabled={isLocked}
                        onChange={(e) => updateRow(day.date, idx, { is_billable: e.target.checked })}
                      >
                        <Text type="secondary" style={{ fontSize: 11 }}>Fact.</Text>
                      </Checkbox>
                    </Col>
                    <Col span={3} style={{ textAlign: 'right' }}>
                      <Space size={0}>
                        <Tooltip title="Repetir este proyecto y tarea de Lunes a Viernes">
                          <Button
                            size="small"
                            type="text"
                            aria-label={`Repetir de Lunes a Viernes registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                            icon={<CopyOutlined />}
                            disabled={isLocked}
                            onClick={() => repeatEntryMonToFri(entry)}
                          />
                        </Tooltip>
                        <Button
                          size="small"
                          type="text"
                          aria-label={`Eliminar registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                          danger
                          icon={<DeleteOutlined />}
                          disabled={isLocked}
                          onClick={() => removeRow(day.date, idx)}
                        />
                      </Space>
                    </Col>
                  </Row>
                  <Row gutter={4} style={{ marginTop: 4 }} align="middle">
                    <Col span={12}>
                      <Select
                        size="small"
                        allowClear
                        placeholder="Tarea (opcional)"
                        aria-label={`Tarea para registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                        style={{ width: '100%' }}
                        value={entry.task_id ?? undefined}
                        disabled={isLocked}
                        onFocus={() => entry.project_id && ensureProjectTasks(entry.project_id)}
                        onChange={(v) => updateRow(day.date, idx, { task_id: v ?? null })}
                      >
                        {(tasksByProject[entry.project_id] || []).map(t => (
                          <Option key={t.id} value={t.id}>{t.title}</Option>
                        ))}
                      </Select>
                    </Col>
                    <Col span={12}>
                      <Input
                        size="small"
                        placeholder="Descripción / nota"
                        aria-label={`Descripción para registro ${idx + 1}, ${dayjs(day.date).locale('es').format('dddd DD/MM')}`}
                        disabled={isLocked}
                        value={entry.description || ''}
                        onChange={(e) => updateRow(day.date, idx, { description: e.target.value })}
                      />
                    </Col>
                  </Row>
                </div>
              ))}
              <Button
                size="small"
                type="dashed"
                icon={<PlusOutlined />}
                block
                disabled={isLocked}
                onClick={() => addRow(day.date)}
              >
                Agregar
              </Button>
            </Card>
          </Col>
        ))}
      </Row>

      <Row justify="end" style={{ marginTop: 16 }}>
        <Space>
          <Button onClick={handleSave} loading={saving || loading} disabled={isLocked}>
            Guardar semana
          </Button>
          <Popconfirm
            title="¿Enviar la semana a aprobación?"
            description="No podrás editarla mientras esté pendiente de revisión."
            onConfirm={handleSubmit}
            disabled={isLocked}
          >
            <Button type="primary" icon={<SendOutlined />} disabled={isLocked}>
              Enviar a aprobación
            </Button>
          </Popconfirm>
        </Space>
      </Row>
    </div>
  );
};

export const TimeTrackingPage: React.FC = () => {
  const { user } = useAuthStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasksByProject, setTasksByProject] = useState<Record<number, TaskOption[]>>({});
  const [activeTimer, setActiveTimer] = useState<ActiveTimer | null>(null);
  const [timerLoading, setTimerLoading] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [selectedTimerProject, setSelectedTimerProject] = useState<number | undefined>(undefined);
  const [selectedTimerTask, setSelectedTimerTask] = useState<number | undefined>(undefined);
  const [timerDescription, setTimerDescription] = useState<string>('');
  const [reminderDates, setReminderDates] = useState<string[]>([]);
  const [gridRefreshSignal, setGridRefreshSignal] = useState(0);

  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'week');

  const canApprove = user?.role === 'team_lead';
  const canSeeEffectiveness = user?.role === 'team_lead' || user?.role === 'rpa_operations';

  const ensureProjectTasks = useCallback(async (projectId: number) => {
    if (!projectId) return;
    try {
      const res = await apiService.get(`/tasks?project_id=${projectId}&limit=100`);
      const list = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      setTasksByProject(prev => ({
        ...prev,
        [projectId]: list.map((t: any) => ({ id: t.id, title: t.title, project_id: t.project_id }))
      }));
    } catch {
      // No-op if project has no tasks or mock returns null
    }
  }, []);

  const loadProjects = async () => {
    try {
      const response = await apiService.getProjects();
      setProjects(response);
    } catch (error) {
      console.error('Error loading projects:', error);
      message.error('Error al cargar proyectos');
    }
  };

  const loadActiveTimer = async () => {
    try {
      const response = await apiService.get('/time-entries/active');
      setActiveTimer(response || null);
    } catch (error) {
      console.error('Error loading active timer:', error);
    }
  };

  const loadReminders = async () => {
    try {
      const data: PendingReminders = await apiService.getTimesheetReminders();
      setReminderDates(data.missing_dates || []);
    } catch (error) {
      console.error('Error loading reminders:', error);
    }
  };

  useEffect(() => {
    const tabFromParams = searchParams.get('tab') || 'week';
    setActiveTab(tabFromParams);
    const presetProject = searchParams.get('project_id');
    const presetTask = searchParams.get('task_id');
    if (presetProject && !Number.isNaN(Number(presetProject))) {
      const pid = Number(presetProject);
      setSelectedTimerProject(pid);
      ensureProjectTasks(pid);
      if (presetTask && !Number.isNaN(Number(presetTask))) {
        setSelectedTimerTask(Number(presetTask));
      }
    }
  }, [searchParams, ensureProjectTasks]);

  useEffect(() => {
    loadProjects();
    loadActiveTimer();
    loadReminders();
    const interval = setInterval(loadActiveTimer, 5000);
    const onGlobalTimerChange = () => {
      void loadActiveTimer();
      setGridRefreshSignal(s => s + 1);
    };
    window.addEventListener('rpa-timer-updated', onGlobalTimerChange);
    return () => {
      clearInterval(interval);
      window.removeEventListener('rpa-timer-updated', onGlobalTimerChange);
    };
  }, []);

  useEffect(() => {
    if (activeTimer) {
      const calc = () => setElapsedTime(dayjs().diff(dayjs(`${activeTimer.date} ${activeTimer.start_time}`), 'second'));
      calc();
      const id = setInterval(calc, 1000);
      return () => clearInterval(id);
    }
    setElapsedTime(0);
  }, [activeTimer]);

  const formatElapsedTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartTimer = async (projectId: number) => {
    try {
      setTimerLoading(true);
      const payload: Record<string, any> = { project_id: projectId };
      if (selectedTimerTask) payload.task_id = selectedTimerTask;
      if (timerDescription.trim()) payload.description = timerDescription.trim();
      const response = await apiService.post('/time-entries/start-timer', payload);
      setActiveTimer(response);
      setTimerDescription('');
      setGridRefreshSignal(s => s + 1);
      window.dispatchEvent(new CustomEvent('rpa-timer-updated'));
    } catch (error: any) {
      message.error(error.response?.data?.error || "Error al iniciar el cronómetro");
    } finally {
      setTimerLoading(false);
    }
  };

  const handleStopTimer = async () => {
    try {
      setTimerLoading(true);
      await apiService.post('/time-entries/stop-timer');
      setActiveTimer(null);
      setGridRefreshSignal(s => s + 1);
      message.success("Cronómetro detenido");
      window.dispatchEvent(new CustomEvent('rpa-timer-updated'));
    } catch (error: any) {
      message.error(error.response?.data?.error || "Error al detener el cronómetro");
    } finally {
      setTimerLoading(false);
    }
  };

  const tabItems = [
    {
      key: 'week',
      label: 'Mi semana',
      children: (
        <WeekGrid
          projects={projects}
          tasksByProject={tasksByProject}
          ensureProjectTasks={ensureProjectTasks}
          refreshSignal={gridRefreshSignal}
        />
      )
    }
  ];

  if (canApprove) {
    tabItems.push({ key: 'approvals', label: 'Aprobaciones', children: <ApprovalsTab /> });
  }
  if (canSeeEffectiveness) {
    tabItems.push({ key: 'effectiveness', label: 'Efectividad', children: <EffectivenessTab /> });
  }

  // Validar que activeTab sea un tab visible; si no, caer a 'week'
  const visibleTabKeys = tabItems.map((item) => item.key);
  const safeActiveTab = visibleTabKeys.includes(activeTab) ? activeTab : 'week';

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>Registro de tiempo</Title>
        <Text type="secondary">Registra horas por proyecto y tarea. Consulta el estado del periodo y, según tu rol, gestiona aprobaciones o revisa la efectividad del equipo.</Text>
      </div>

      {reminderDates.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Tienes ${reminderDates.length} día(s) hábil(es) sin horas registradas en las últimas 2 semanas`}
          description={reminderDates.map(formatReminderDate).join(', ')}
        />
      )}

      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            Cronómetro de trabajo
          </Space>
        }
        style={{ marginBottom: 24 }}
      >
        {activeTimer ? (
          <Row gutter={16} align="middle">
            <Col>
              <Statistic title="Tiempo transcurrido" value={formatElapsedTime(elapsedTime)} valueStyle={{ fontFamily: 'monospace' }} />
            </Col>
            <Col flex="auto">
              <Space direction="vertical" size={2}>
                <Link to={`/projects/${activeTimer.project_id}`}>{activeTimer.project_name || 'Abrir proyecto'}</Link>
                {activeTimer.task_title && <Tag color="blue">{activeTimer.task_title}</Tag>}
                {activeTimer.description && <Text type="secondary">{activeTimer.description}</Text>}
              </Space>
            </Col>
            <Col>
              <Button type="primary" danger icon={<PauseCircleOutlined />} loading={timerLoading} onClick={handleStopTimer}>
                Detener cronómetro
              </Button>
            </Col>
          </Row>
        ) : (
          <Space wrap>
            <Select
              placeholder="Proyecto"
              style={{ width: 220 }}
              value={selectedTimerProject}
              onChange={(v) => {
                setSelectedTimerProject(v);
                setSelectedTimerTask(undefined);
                ensureProjectTasks(v);
              }}
            >
              {projects.map(p => <Option key={p.id} value={p.id}>{p.name}</Option>)}
            </Select>
            <Select
              allowClear
              placeholder="Tarea (opcional)"
              style={{ width: 220 }}
              value={selectedTimerTask}
              disabled={!selectedTimerProject}
              onChange={(v) => setSelectedTimerTask(v)}
            >
              {(selectedTimerProject ? (tasksByProject[selectedTimerProject] || []) : []).map(t => (
                <Option key={t.id} value={t.id}>{t.title}</Option>
              ))}
            </Select>
            <Input
              placeholder="Actividad / nota rápida (opcional)"
              style={{ width: 240 }}
              value={timerDescription}
              onChange={(e) => setTimerDescription(e.target.value)}
            />
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={timerLoading}
              disabled={!selectedTimerProject}
              onClick={() => selectedTimerProject && handleStartTimer(selectedTimerProject)}
            >
              Iniciar timer
            </Button>
          </Space>
        )}
      </Card>

      <Tabs
        items={tabItems}
        activeKey={safeActiveTab}
        onChange={(key) => {
          setActiveTab(key);
          setSearchParams(key === 'week' ? {} : { tab: key }, { replace: true });
        }}
      />
    </div>
  );
};

const ApprovalsTab: React.FC = () => {
  const { token } = theme.useToken();
  const [periods, setPeriods] = useState<TimesheetPeriod[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data: TimesheetPeriod[] = await apiService.getPendingTimesheetApprovals();
      setPeriods(data);
    } catch (error) {
      message.error('Error al cargar aprobaciones pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: number) => {
    try {
      await apiService.approveTimesheetWeek(id);
      message.success('Semana aprobada');
      load();
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Error al aprobar');
    }
  };

  const handleReject = async (id: number) => {
    const reason = window.prompt('Motivo del rechazo:');
    if (!reason) return;
    try {
      await apiService.rejectTimesheetWeek(id, reason);
      message.success('Semana rechazada');
      load();
    } catch (error: any) {
      message.error(error.response?.data?.error || 'Error al rechazar');
    }
  };

  return (
    <Table
      loading={loading}
      dataSource={periods}
      rowKey="id"
      expandable={{
        expandedRowRender: (record: TimesheetPeriod) => {
          const entries = record.entries || [];
          if (entries.length === 0) {
            return <Text type="secondary">Sin desglose de registros disponible para esta semana.</Text>;
          }
          return (
            <div style={{ padding: '8px 12px', border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius }}>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>
                Desglose de imputaciones ({entries.length} registros · {record.total_hours}h totales)
              </Text>
              <Table
                size="small"
                pagination={false}
                rowKey="id"
                dataSource={entries}
                columns={[
                  { title: 'Fecha', dataIndex: 'date', width: 110, render: (d: string) => dayjs(d).format('DD/MM/YYYY') },
                  { title: 'Proyecto', dataIndex: 'project_name', render: (name: string, e) => <Link to={`/projects/${e.project_id}`}>{name}</Link> },
                  { title: 'Tarea', dataIndex: 'task_title', render: (t: string | null) => t ? <Tag color="blue">{t}</Tag> : <Text type="secondary">-</Text> },
                  { title: 'Descripción / Actividad', dataIndex: 'description', render: (d: string | null) => d || <Text type="secondary">-</Text> },
                  { title: 'Horas', dataIndex: 'hours', width: 90, render: (h: number) => <Text strong>{h}h</Text> },
                  { title: 'Tipo', dataIndex: 'is_billable', width: 110, render: (b: boolean) => <Tag color={b ? 'green' : 'default'}>{b ? 'Facturable' : 'Interna'}</Tag> }
                ]}
              />
            </div>
          );
        }
      }}
      columns={[
        { title: 'Persona', dataIndex: 'user_name' },
        { title: 'Semana', render: (_: any, r: TimesheetPeriod) => `${dayjs(r.period_start).format('DD/MM/YY')}–${dayjs(r.period_end).format('DD/MM/YY')}` },
        {
          title: 'Proyectos imputados',
          render: (_: any, r: TimesheetPeriod) => {
            const entries = r.entries || [];
            if (!entries.length) return <Text type="secondary">Expandir para revisar</Text>;
            const byProject = new Map<string, number>();
            entries.forEach(e => {
              byProject.set(e.project_name, (byProject.get(e.project_name) || 0) + Number(e.hours || 0));
            });
            return (
              <Space wrap size={4}>
                {Array.from(byProject.entries()).map(([proj, hrs]) => (
                  <Tag key={proj} color="processing">{proj}: {hrs}h</Tag>
                ))}
              </Space>
            );
          }
        },
        { title: 'Horas', dataIndex: 'total_hours', render: (h: number) => <Text strong>{h}h</Text> },
        {
          title: 'Acciones',
          render: (_: any, r: TimesheetPeriod) => (
            <Space>
              <Button size="small" type="primary" onClick={() => handleApprove(r.id)}>Aprobar</Button>
              <Button size="small" danger onClick={() => handleReject(r.id)}>Rechazar</Button>
            </Space>
          )
        }
      ]}
    />
  );
};

const EffectivenessTab: React.FC = () => {
  const [metrics, setMetrics] = useState<EffectivenessMetrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const from = dayjs().startOf('month').format('YYYY-MM-DD');
    const to = dayjs().endOf('month').format('YYYY-MM-DD');
    setLoading(true);
    apiService.getEffectivenessMetrics(from, to)
      .then(setMetrics)
      .catch(() => message.error('Error al cargar métricas de efectividad'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <Title level={4}>Por persona (mes actual)</Title>
      <Table
        loading={loading}
        locale={{ emptyText: 'No hay registros de efectividad para este mes.' }}
        dataSource={metrics?.by_person || []}
        rowKey="user_id"
        columns={[
          { title: 'Persona', dataIndex: 'user_name' },
          { title: 'Estimado (h)', dataIndex: 'estimated_hours' },
          { title: 'Real (h)', dataIndex: 'real_hours' },
          { title: 'Utilización %', dataIndex: 'utilization_pct', render: (v: number) => `${v}%` },
          { title: 'Facturable %', dataIndex: 'billable_pct', render: (v: number) => `${v}%` }
        ]}
      />
      <Title level={4} style={{ marginTop: 24 }}>Por tarea (mes actual)</Title>
      <Table
        loading={loading}
        locale={{ emptyText: 'No hay tareas con tiempo registrado este mes.' }}
        dataSource={metrics?.by_task || []}
        rowKey="task_id"
        columns={[
          { title: 'Tarea', dataIndex: 'task_title' },
          { title: 'Proyecto', dataIndex: 'project_name' },
          { title: 'Estimado (h)', dataIndex: 'estimated_hours' },
          { title: 'Real (h)', dataIndex: 'real_hours' },
          {
            title: 'Desvío (h)', dataIndex: 'variance_hours',
            render: (v: number) => <Tag color={v > 0 ? 'red' : 'green'}>{v > 0 ? '+' : ''}{v}</Tag>
          }
        ]}
      />
    </div>
  );
};
