import { ProjectTeamEditor } from './ProjectTeamEditor';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography, App, theme } from 'antd';
import { CalendarOutlined, CheckCircleOutlined, DeleteOutlined, DollarOutlined, EditOutlined, FileTextOutlined, PlusOutlined, TeamOutlined, UserAddOutlined, PieChartOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { apiService } from '@/services/api';
import { fileService } from '@/services/fileService';
import { User } from '@/types/auth';
import { Project } from '@/types/project';
import { FileManager } from '@/components/files';
import { FilePreviewModal } from '@/components/files/FilePreviewModal';
import { CostCenterDistributionPicker } from '@/components/costCenters/CostCenterDistributionPicker';
import { CostCenterTag } from '@/components/costCenters/CostCenterTag';
import { ProjectCostCenterAllocation } from '@/types/costCenter';

const { Text, Title } = Typography;
interface Props { project: Project; user?: User; onRefresh?: () => void; initialTab?: string; onTabChange?: (tab: string) => void; }
type Row = Record<string, any>;
const rowsFrom = (response: any): Row[] => {
  const payload = response?.data ?? response;
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.data) ? payload.data : [];
};

export const ProjectCommercialSection: React.FC<Props> = ({ project, user, onRefresh, initialTab = 'commercial', onTabChange }) => {
  const { token } = theme.useToken();
  const isDark = document.documentElement.dataset.theme === 'dark' || token.colorBgBase === '#0F0F10' || token.colorBgContainer === '#171718';
  const { message, modal } = App.useApp();
  const [teamEditorOpen, setTeamEditorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => setActiveTab(initialTab), [initialTab]);
  const [quoteForm] = Form.useForm();
  const [capacityForm] = Form.useForm();
  const [meetings, setMeetings] = useState<Row[]>([]);
  const [quotes, setQuotes] = useState<Row[]>([]);
  const [documents, setDocuments] = useState<Row[]>([]);
  const [capacity, setCapacity] = useState<Row[]>([]);
  const [paymentMilestones, setPaymentMilestones] = useState<Row[]>([]);
  const [invoices, setInvoices] = useState<Row[]>([]);
  const [scopeChanges, setScopeChanges] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [scopeQuoteId, setScopeQuoteId] = useState<number | null>(null);
  const [completeMilestoneTarget, setCompleteMilestoneTarget] = useState<Row | null>(null);
  const [completeNotes, setCompleteNotes] = useState('');
  const [completing, setCompleting] = useState(false);
  const [capacityModalOpen, setCapacityModalOpen] = useState(false);
  const [editingCapacity, setEditingCapacity] = useState<Row | null>(null);
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [teamUsers, setTeamUsers] = useState<Array<{ id: number; full_name: string; email: string; role: string }>>([]);
  const [previewFileId, setPreviewFileId] = useState<number | null>(null);
  const [projectAllocations, setProjectAllocations] = useState<ProjectCostCenterAllocation[]>([]);
  const [costCenterModalOpen, setCostCenterModalOpen] = useState(false);
  const [editingAllocations, setEditingAllocations] = useState<ProjectCostCenterAllocation[]>([]);
  const [savingAllocations, setSavingAllocations] = useState(false);
  const [supportHandoverResult, setSupportHandoverResult] = useState<Row | null>(null);
  const [transitioningSupport, setTransitioningSupport] = useState(false);
  const [slaHoursMonthly, setSlaHoursMonthly] = useState<number>(20);
  const isLead = user?.role === 'team_lead';
  const canManage = isLead || user?.role === 'rpa_operations';
  const canViewBilling = isLead || canManage || user?.role === 'billing';
  const hasClientAcceptanceEvidence = documents.some((row) => row.document_type === 'client_approval');
  const base = `/commercial/projects/${project.id}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        apiService.request({ url: `${base}/meetings` }),
        canManage ? apiService.request({ url: `${base}/quotes` }) : Promise.resolve({ data: { data: [] } }),
        apiService.request({ url: `${base}/documents` }),
        canManage ? apiService.request({ url: `${base}/capacity` }) : Promise.resolve({ data: { data: [] } }),
        canViewBilling ? apiService.getPaymentMilestones(project.id) : Promise.resolve([]),
        canViewBilling ? apiService.getInvoices(project.id) : Promise.resolve([]),
        apiService.request({ url: `/lifecycle/projects/${project.id}/scope-changes` }),
        canManage ? apiService.getProjectCostCenters(project.id) : Promise.resolve({ allocations: [] })
      ]);
      if (results[0].status === 'fulfilled') setMeetings(rowsFrom(results[0].value));
      if (results[1].status === 'fulfilled') setQuotes(rowsFrom(results[1].value));
      else message.error('No se pudieron cargar las versiones de cotización. Verifica que tengas permiso financiero.');
      if (results[2].status === 'fulfilled') setDocuments(rowsFrom(results[2].value));
      if (results[3].status === 'fulfilled') setCapacity(rowsFrom(results[3].value));
      if (results[4].status === 'fulfilled') setPaymentMilestones(rowsFrom(results[4].value));
      if (results[5].status === 'fulfilled') setInvoices(rowsFrom(results[5].value));
      else message.error('No se pudieron cargar facturas y pagos. Verifica que tengas permiso financiero.');
      if (results[6].status === 'fulfilled') setScopeChanges(rowsFrom(results[6].value));
      if (results[7]?.status === 'fulfilled') {
        const payload: any = results[7].value;
        const allocs = payload?.allocations || payload?.data?.allocations || (Array.isArray(payload) ? payload : []);
        setProjectAllocations(Array.isArray(allocs) ? allocs : []);
      }
    } catch {
      message.error('No se pudo cargar el seguimiento comercial');
    } finally { setLoading(false); }
  }, [base, canManage, canViewBilling, message, project.id]);

  const handleSaveCostCenters = async () => {
    try {
      setSavingAllocations(true);
      await apiService.setProjectCostCenters(project.id, {
        allocations: editingAllocations,
      });
      message.success('Imputación por Centro de Costo guardada exitosamente');
      setCostCenterModalOpen(false);
      await load();
      onRefresh?.();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al guardar la imputación por CECO');
    } finally {
      setSavingAllocations(false);
    }
  };

  useEffect(() => { void load(); }, [load]);

  const save = async (url: string, data: Row, success: string, method: 'post' | 'patch' = 'post') => {
    try {
      if (method === 'patch') await apiService.request({ url, method: 'PATCH', data });
      else await apiService.post(url, data);
      message.success(success);
      await load();
      onRefresh?.();
      return true;
    } catch (error: any) {
      message.error(error?.response?.data?.error || 'No se pudo guardar el registro');
      return false;
    }
  };

  const requestLost = () => modal.confirm({
    title: 'Cerrar oportunidad como perdida',
    content: <Input.TextArea id="loss-reason" placeholder="Motivo del cierre" rows={3} />,
    okText: 'Cerrar oportunidad', cancelText: 'Cancelar',
    onOk: async () => {
      const reason = (document.getElementById('loss-reason') as HTMLTextAreaElement | null)?.value.trim();
      if (!reason) { message.error('Registra el motivo del cierre'); throw new Error('reason required'); }
      await save(`${base}/lost`, { reason }, 'Oportunidad cerrada');
    }
  });

  const requestRejectQuote = (quoteId: number) => modal.confirm({
    title: 'Rechazar versión de cotización',
    content: <Input.TextArea id="reject-reason" placeholder="Motivo del rechazo" rows={3} />,
    okText: 'Rechazar versión', cancelText: 'Cancelar',
    onOk: async () => {
      const reason = (document.getElementById('reject-reason') as HTMLTextAreaElement | null)?.value.trim();
      if (!reason) { message.error('Registra el motivo del rechazo'); throw new Error('reason required'); }
      await save(`/commercial/quotes/${quoteId}/reject`, { reason }, 'Cotización rechazada');
    }
  });

  const logMeeting = async (values: Row) => {
    const done = await save(`${base}/meetings`, { ...values, meeting_date: values.meeting_date.toISOString(), has_pdd: Boolean(values.has_pdd), has_technical_commercial_proposal: Boolean(values.has_technical_commercial_proposal) }, 'Reunión registrada');
    if (done) setMeetingOpen(false);
  };

  const createQuote = async (values: Row) => {
    const done = await save(`${base}/quotes`, values, 'Nueva versión de cotización registrada');
    if (done) setQuoteOpen(false);
  };

  const estimateQuoteCost = async () => {
    try {
      const { hours, currency } = await quoteForm.validateFields(['hours', 'currency']);
      const response = await apiService.request({ url: `${base}/quote-cost-estimate?hours=${encodeURIComponent(hours)}&currency=${encodeURIComponent(currency)}` });
      const estimate = response?.data?.estimated_cost ?? response?.estimated_cost;
      if (!Number.isFinite(Number(estimate))) throw new Error('No se recibió una estimación válida');
      quoteForm.setFieldValue('estimated_cost', estimate);
      message.success('Costo estimado según el costo horario del equipo');
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(error?.response?.data?.error || error?.message || 'No se pudo estimar el costo');
    }
  };

  const downloadQuoteFile = async (fileId: number) => {
    try {
      const [blob, fileInfo] = await Promise.all([
        fileService.downloadFile(fileId),
        fileService.getFile(fileId).catch(() => null)
      ]);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileInfo?.original_filename || `cotizacion-${fileId}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      message.error('No se pudo descargar el archivo');
    }
  };

  const recordDocument = async (values: Row) => {
    const done = await save(`${base}/documents`, { ...values, document_type: documentType, document_date: values.document_date?.format('YYYY-MM-DD') }, 'Documento registrado');
    if (done) setDocumentType(null);
  };

  const handleTransitionToSupport = async () => {
    setTransitioningSupport(true);
    try {
      const response = await apiService.transitionProjectToSupport(project.id, {
        contracted_hours_monthly: slaHoursMonthly || 20
      });
      const data = response?.data || response;
      setSupportHandoverResult(data);
      message.success(response?.message || 'Proyecto traspasado a Soporte y Operación');
      await load();
      onRefresh?.();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'No se pudo traspasar el proyecto a soporte');
    } finally {
      setTransitioningSupport(false);
    }
  };

  const quoteColumns: any[] = [
    { title: 'Versión', dataIndex: 'version', render: (v: number) => `v${v}` },
    { title: 'Tipo', dataIndex: 'pricing_model', render: (v: string) => ({ fixed: 'Precio fijo', hourly: 'Por horas', mixed: 'Mixta' }[v] || v) },
    ...(canManage ? [{ title: 'Monto', dataIndex: 'amount', render: (v: number | null, row: Row) => v == null ? '—' : `${row.currency || 'CLP'} ${Number(v).toLocaleString('es-CL')}` }] : []),
    ...(isLead ? [{ title: 'Margen', dataIndex: 'margin_percent', render: (v: number | null) => v == null ? 'Por definir' : `${Number(v).toFixed(1)}%` }] : []),
    { title: 'Archivo', dataIndex: 'file_id', render: (v: number | null) => v ? <Space wrap><Button type="link" size="small" onClick={() => setPreviewFileId(v)}>Previsualizar</Button><Button type="link" size="small" onClick={() => void downloadQuoteFile(v)}>Descargar</Button></Space> : 'Sin archivo' },
    { title: 'Estado', dataIndex: 'status', render: (v: string) => <Tag color={v === 'approved' ? 'green' : v === 'replaced' ? 'default' : 'blue'}>{({ sent: 'Enviada', approved: 'Validada por jefatura', replaced: 'Reemplazada', rejected: 'Rechazada', draft: 'Borrador' } as Row)[v] || v}</Tag> },
    { title: 'Registrada', dataIndex: 'created_at', render: (v: string) => v ? dayjs(v).format('DD MMM YYYY') : '—' },
    ...(isLead ? [{ title: 'Acción', key: 'action', render: (_: unknown, row: Row) => row.status === 'sent' ? <Space>
      <Button size="small" onClick={() => row.scope_change_id ? setScopeQuoteId(row.id) : void save(`/commercial/quotes/${row.id}/approve`, {}, 'Cotización validada por jefatura')}>Validar versión</Button>
      <Button size="small" danger onClick={() => requestRejectQuote(row.id)}>Rechazar</Button>
    </Space> : null }] : [])
  ];

  const commercialContent = <div className="commercial-workspace">
    <div className="commercial-summary-line">
      <div><Text className="section-kicker">ETAPA COMERCIAL</Text><Title level={4}>{project.commercial_stage === 'approved' ? 'Aprobado por cliente' : project.commercial_stage === 'lost' ? 'Oportunidad perdida' : 'En cotización'}</Title></div>
      <Space wrap>
        {canManage && project.commercial_stage === 'quoting' && <Button icon={<CalendarOutlined />} onClick={() => setMeetingOpen(true)}>Registrar reunión</Button>}
        {canManage && project.commercial_stage !== 'lost' && <Button icon={<FileTextOutlined />} onClick={() => setQuoteOpen(true)}>Nueva cotización</Button>}
        {isLead && project.commercial_stage === 'quoting' && <Button type="primary" onClick={() => setApprovalOpen(true)}>Registrar aprobación cliente</Button>}
        {canManage && project.commercial_stage === 'approved' && project.status !== 'active' && project.status !== 'completed' && (
          <Button
            type="primary"
            style={{ backgroundColor: token.colorSuccess, borderColor: token.colorSuccess }}
            icon={<CheckCircleOutlined />}
            onClick={() => modal.confirm({
              title: 'Iniciar ejecución del proyecto',
              content: project.require_purchase_order && !documents.some((d) => d.document_type === 'purchase_order')
                ? 'El proyecto requiere orden de compra obligatoria antes de iniciar. Por favor regístrala primero.'
                : '¿Confirmas el inicio de ejecución? El estado del proyecto cambiará a Activo.',
              okText: 'Iniciar ejecución',
              cancelText: 'Cancelar',
              okButtonProps: {
                disabled: Boolean(project.require_purchase_order && !documents.some((d) => d.document_type === 'purchase_order'))
              },
              onOk: async () => {
                await save(`${base}/start-execution`, {}, 'Ejecución iniciada exitosamente');
              }
            })}
          >
            Iniciar ejecución
          </Button>
        )}
        {isLead && project.commercial_stage === 'quoting' && <Button danger type="text" onClick={requestLost}>Marcar perdida</Button>}
      </Space>
    </div>
    {project.commercial_stage === 'approved' && project.status !== 'active' && project.status !== 'completed' && (
      <Alert
        showIcon
        type="success"
        message="Aprobación del cliente registrada"
        description={
          project.require_purchase_order && !documents.some((d) => d.document_type === 'purchase_order')
            ? 'El proyecto requiere orden de compra antes de pasar a ejecución activa. Regístrala en la pestaña Contratos y cierre.'
            : 'Todo listo para iniciar la ejecución del proyecto. Presiona "Iniciar ejecución" para activar el proyecto.'
        }
        style={{ marginBottom: 16 }}
      />
    )}
    {project.commercial_stage === 'quoting' && meetings.length >= 2 && !meetings.some((m) => m.has_pdd || m.has_technical_commercial_proposal) && <Alert showIcon type={meetings.length >= 3 ? 'error' : 'warning'} message={meetings.length >= 3 ? 'Escalación: aún falta el PDD o la propuesta técnico comercial' : 'Después de dos reuniones falta registrar el PDD o la propuesta'} description="Registra el motivo y el próximo compromiso en la reunión siguiente." />}
    <div className="commercial-columns">
      <Card title="Reuniones y compromisos" extra={canManage && project.commercial_stage === 'quoting' ? <Button type="text" icon={<PlusOutlined />} onClick={() => setMeetingOpen(true)}>Agregar</Button> : null}>
        {meetings.length ? <Table size="small" rowKey="id" pagination={false} loading={loading} dataSource={meetings} columns={[
          { title: '#', render: (_: unknown, _row: Row, index: number) => index + 1 },
          { title: 'Fecha', dataIndex: 'meeting_date', render: (v: string) => dayjs(v).format('DD MMM YYYY') },
          { title: 'Resultado', dataIndex: 'summary' },
          { title: 'Siguiente compromiso', dataIndex: 'next_commitment', render: (v: string) => v || 'Pendiente' },
          { title: 'Entregable', render: (_: unknown, r: Row) => r.has_pdd ? 'PDD' : r.has_technical_commercial_proposal ? 'Propuesta' : '—' }
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Registra la primera reunión para iniciar la trazabilidad" />}
      </Card>
      <Card title="Versiones de cotización" extra={canManage && project.commercial_stage !== 'lost' ? <Button type="text" icon={<PlusOutlined />} onClick={() => setQuoteOpen(true)}>Nueva versión</Button> : null}>
        {quotes.length ? <Table size="small" rowKey="id" pagination={false} loading={loading} dataSource={quotes} columns={quoteColumns} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Aún no hay una cotización registrada" />}
        {isLead && quotes.find((q) => q.status === 'approved') && <div className="commercial-margin-note"><DollarOutlined /> La validación interna de la versión no sustituye la aprobación del cliente. Esta versión fija precio y horas del proyecto.</div>}
      </Card>
    </div>
    {canManage && (
      <Card
        title={
          <Space>
            <PieChartOutlined style={{ color: '#1890ff' }} />
            <span>Imputación por Centro de Costo (CECOs)</span>
          </Space>
        }
        extra={
          <Button
            type="primary"
            ghost
            icon={<EditOutlined />}
            size="small"
            onClick={() => {
              setEditingAllocations(Array.isArray(projectAllocations) && projectAllocations.length ? [...projectAllocations] : []);
              setCostCenterModalOpen(true);
            }}
          >
            {projectAllocations.length ? 'Editar Imputación' : 'Configurar Imputación'}
          </Button>
        }
        style={{ marginTop: 16 }}
      >
        {projectAllocations.length ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  height: 12,
                  width: '100%',
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : '#f0f2f5',
                  borderRadius: 6,
                  overflow: 'hidden',
                  display: 'flex',
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                {projectAllocations.map((item, idx) => {
                  const colors: Record<string, string> = {
                    'RPA-L': '#13c2c2',
                    'RPA-P': isDark ? '#597ef7' : '#2f54eb',
                    'RPA-S': isDark ? '#9254de' : '#722ed1',
                    'P-RPA-L': '#13c2c2',
                    'P-RPA-P': isDark ? '#597ef7' : '#2f54eb',
                    'P-RPA-S': isDark ? '#9254de' : '#722ed1',
                    'U-RPA-L': '#13c2c2',
                    'U-RPA-P': isDark ? '#597ef7' : '#2f54eb',
                    'U-RPA-S': isDark ? '#9254de' : '#722ed1',
                  };
                  const color = colors[item.cost_center_code || ''] || '#fa8c16';
                  return (
                    <div
                      key={idx}
                      style={{
                        width: `${item.percentage || 0}%`,
                        backgroundColor: color,
                        height: '100%',
                      }}
                      title={`${item.cost_center_code}: ${item.percentage}%`}
                    />
                  );
                })}
              </div>
            </div>
            <Table
              size="small"
              pagination={false}
              dataSource={projectAllocations}
              rowKey={(r) => r.id || r.cost_center_id}
              columns={[
                {
                  title: 'Centro de Costo',
                  key: 'ceco',
                  render: (_: unknown, r: ProjectCostCenterAllocation) => (
                    <CostCenterTag
                      code={r.cost_center_code}
                      name={r.cost_center_name}
                      country={r.country}
                      isRpa={r.is_rpa}
                      showName
                      showCountry
                    />
                  ),
                },
                {
                  title: 'Monto Imputado',
                  dataIndex: 'amount',
                  render: (v: number, r: ProjectCostCenterAllocation) =>
                    `${r.currency || project.currency || 'CLP'} ${Number(v).toLocaleString('es-CL')}`,
                },
                {
                  title: 'Distribución',
                  dataIndex: 'percentage',
                  render: (v: number) => <Tag color="blue">{v}%</Tag>,
                },
                {
                  title: 'Concepto / Glosa',
                  dataIndex: 'description',
                  render: (v: string) => v || '-',
                },
              ]}
            />
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Aún no se ha definido la imputación por centro de costos para este proyecto."
          >
            <Button
              type="primary"
              size="small"
              onClick={() => {
                setEditingAllocations([]);
                setCostCenterModalOpen(true);
              }}
            >
              Configurar Imputación
            </Button>
          </Empty>
        )}
      </Card>
    )}
  </div>;

  const deliveryContent = <div className="commercial-workspace">
      <Card title="Requisitos contractuales" extra={<Text type="secondary">Configurables por proyecto</Text>}>
      <Descriptions column={{ xs: 1, md: 2 }}>
        <Descriptions.Item label="Orden de compra antes de ejecutar"><Switch disabled={!canManage} checked={Boolean(project.require_purchase_order)} onChange={(value) => void save(`${base}/requirements`, { require_purchase_order: value }, 'Requisito actualizado', 'patch')} /></Descriptions.Item>
        <Descriptions.Item label="HES antes de facturar"><Switch disabled={!canManage} checked={Boolean(project.require_service_acceptance)} onChange={(value) => void save(`${base}/requirements`, { require_service_acceptance: value }, 'Requisito actualizado', 'patch')} /></Descriptions.Item>
      </Descriptions>
      <Space wrap>
        {canManage && <Button onClick={() => setDocumentType('pdd')}>Registrar PDD</Button>}
        {canManage && <Button onClick={() => setDocumentType('technical_commercial_proposal')}>Registrar propuesta</Button>}
        {canManage && <Button onClick={() => setDocumentType('purchase_order')}>Registrar OC</Button>}
        {canManage && <Button onClick={() => setDocumentType('service_acceptance')}>Registrar HES</Button>}
        {canManage && <Button onClick={() => setDocumentType('client_approval')}>Registrar evidencia cliente</Button>}
      </Space>
      <Table size="small" rowKey="id" pagination={false} loading={loading} dataSource={documents} columns={[
        { title: 'Documento', dataIndex: 'document_type', render: (v: string) => ({ purchase_order: 'Orden de compra', service_acceptance: 'HES / aceptación de servicio', client_approval: 'Aprobación cliente', pdd: 'PDD', technical_commercial_proposal: 'Propuesta técnico comercial' } as Row)[v] || v },
        { title: 'Referencia', dataIndex: 'reference_number', render: (v: string) => v || '—' },
        { title: 'Archivo', dataIndex: 'original_filename', render: (v: string, row: Row) => row.file_id ? <Button type="link" onClick={() => setPreviewFileId(row.file_id)}>{v || 'Previsualizar documento'}</Button> : 'Sin archivo adjunto' },
        { title: 'Fecha', dataIndex: 'document_date', render: (v: string) => v ? dayjs(v).format('DD MMM YYYY') : '—' },
        { title: 'Notas', dataIndex: 'notes', render: (v: string) => v || '—' }
      ]} />
    </Card>
    <div className="commercial-columns">
      <Card className="commercial-close-card" title="Cierre de entrega" extra={project.delivery_accepted_at ? <Tag color="green">Aceptada</Tag> : <Tag>Abierta</Tag>}>
        <Text type="secondary">Registra el OK del cliente y la evidencia antes de dar por terminada la entrega.</Text>
        {!project.delivery_accepted_at && canManage && (hasClientAcceptanceEvidence
          ? <Button icon={<CheckCircleOutlined />} onClick={() => void save(`${base}/delivery-acceptance`, {}, 'Entrega aceptada')}>Cerrar entrega con evidencia registrada</Button>
          : <Button onClick={() => setDocumentType('client_approval')}>Registrar OK del cliente</Button>)}
        {project.delivery_accepted_at && <p>Entrega aceptada el {dayjs(project.delivery_accepted_at).format('DD MMM YYYY')}</p>}
      </Card>
      <Card className="commercial-close-card" title="Cierre financiero" extra={project.financial_closed_at ? <Tag color="green">Cerrado</Tag> : <Tag color="gold">Pendiente</Tag>}>
        <Text type="secondary">Pendiente hasta que la entrega esté aceptada, cada hito esté pagado y no existan facturas con saldo ni documentos obligatorios pendientes.</Text>
        {isLead && project.delivery_accepted_at && !project.financial_closed_at && <Button type="primary" onClick={() => modal.confirm({ title: '¿Cerrar las finanzas del proyecto?', content: 'Esta acción registra el cierre financiero y completa el proyecto.', okText: 'Confirmar cierre', cancelText: 'Cancelar', onOk: async () => { await save(`${base}/financial-close`, {}, 'Cierre financiero completado'); } })}>Cerrar finanzas</Button>}
        {project.financial_closed_at && <p>Cierre financiero el {dayjs(project.financial_closed_at).format('DD MMM YYYY')}</p>}
      </Card>
    </div>
    <Card
      className="commercial-close-card"
      title="Traspaso a Soporte y Operación (Contrato SLA)"
      extra={supportHandoverResult ? <Tag color="green">Contrato Activo</Tag> : <Tag color="blue">Post-Go-Live</Tag>}
      style={{ marginTop: 16 }}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        Crea o vincula automáticamente al cliente y el proceso RPA en el módulo de Soporte y Operación tras la puesta en producción.
      </Text>
      {supportHandoverResult ? (
        <Alert
          type="success"
          showIcon
          message={`Proceso RPA registrado en Soporte: ${supportHandoverResult?.process?.process_name || project.name}`}
          description={`Cliente: ${supportHandoverResult?.company?.company_name || project.client_name || project.name} · Bolsa mensual: ${supportHandoverResult?.company?.contracted_hours_monthly || slaHoursMonthly} h/mes.`}
          action={<Button size="small" type="primary" href="/support">Ir a Soporte</Button>}
        />
      ) : (
        canManage && (
          <Space wrap align="center">
            <Text>Horas SLA contratadas/mes:</Text>
            <InputNumber
              min={1}
              max={500}
              value={slaHoursMonthly}
              onChange={(val) => setSlaHoursMonthly(Number(val) || 20)}
              addonAfter="h/mes"
              style={{ width: 130 }}
            />
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              loading={transitioningSupport}
              onClick={() => void handleTransitionToSupport()}
            >
              Pasar a Soporte (Crear Contrato SLA)
            </Button>
          </Space>
        )
      )}
    </Card>
  </div>;

  const handleConfirmCompleteMilestone = async () => {
    if (!completeMilestoneTarget) return;
    setCompleting(true);
    try {
      await apiService.completePaymentMilestone(completeMilestoneTarget.id, completeNotes.trim() || undefined);
      message.success('Hito marcado como cumplido y notificado a Facturación');
      setCompleteMilestoneTarget(null);
      setCompleteNotes('');
      await load();
      onRefresh?.();
    } catch (error: any) {
      message.error(error?.response?.data?.error || 'No se pudo marcar el hito como cumplido');
    } finally {
      setCompleting(false);
    }
  };

  const openAssignModal = (row?: Row) => {
    if (row) {
      setEditingCapacity(row);
      capacityForm.setFieldsValue({
        user_id: row.user_id,
        role: row.role,
        allocation_percentage: row.allocation_percentage ?? 100,
        budgeted_hours: row.budgeted_hours,
        dates: row.start_date && row.end_date ? [dayjs(row.start_date), dayjs(row.end_date)] : undefined
      });
    } else {
      setEditingCapacity(null);
      capacityForm.resetFields();
      capacityForm.setFieldsValue({ allocation_percentage: 100 });
    }
    setCapacityModalOpen(true);
    if (!teamUsers.length) {
      apiService.getUsers().then(res => setTeamUsers(res || [])).catch(() => {});
    }
  };

  const handleSaveCapacity = async (values: any) => {
    setSavingCapacity(true);
    try {
      const payload = {
        user_id: values.user_id,
        role: values.role,
        allocation_percentage: values.allocation_percentage,
        budgeted_hours: values.budgeted_hours != null ? Number(values.budgeted_hours) : undefined,
        start_date: values.dates?.[0]?.format('YYYY-MM-DD'),
        end_date: values.dates?.[1]?.format('YYYY-MM-DD')
      };
      await apiService.saveProjectCapacity(project.id, payload);
      message.success(editingCapacity ? 'Asignación actualizada' : 'Persona asignada al proyecto');
      setCapacityModalOpen(false);
      await load();
      onRefresh?.();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al guardar asignación');
    } finally {
      setSavingCapacity(false);
    }
  };

  const handleDeleteCapacity = async (userId: number) => {
    try {
      await apiService.deleteProjectCapacity(project.id, userId);
      message.success('Persona desasignada del proyecto');
      await load();
      onRefresh?.();
    } catch (err: any) {
      message.error(err?.response?.data?.error || 'Error al desasignar persona');
    }
  };

  const billingContent = <div className="commercial-workspace">
    <div className="commercial-kpis">
      <Statistic title="Hitos cobrables" value={paymentMilestones.filter((m) => m.status === 'billable').length} />
      <Statistic title="Facturas emitidas" value={invoices.length} />
      <Statistic title="Facturas vencidas" value={invoices.filter((i) => i.status === 'overdue').length} />
      <Statistic title="Hitos pagados" value={paymentMilestones.filter((m) => m.status === 'paid').length} />
    </div>
    <div className="commercial-columns">
      <Card
        title="Hitos de pago"
        extra={<Button type="link" onClick={() => window.open(`/billing?tab=milestones&project_id=${project.id}`, '_self')}>Ver en Facturación</Button>}
      >
        {paymentMilestones.length ? <Table size="small" rowKey="id" pagination={false} dataSource={paymentMilestones} columns={[
          { title: 'Hito', dataIndex: 'name' },
          {
            title: 'Centro de Costo',
            key: 'cost_center',
            render: (_: unknown, r: Row) => (
              <CostCenterTag
                code={r.cost_center_code}
                name={r.cost_center_name}
                country={r.cost_center_country}
                isRpa={r.cost_center_is_rpa}
                size="small"
              />
            ),
          },
          { title: 'Fecha prevista', dataIndex: 'planned_date', render: (v: string) => v ? dayjs(v).format('DD MMM YYYY') : 'Por definir' },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (v: string) => {
              const statusMap: Record<string, { label: string; color: string }> = {
                pending: { label: 'Pendiente', color: 'default' },
                billable: { label: 'Listo para facturar', color: 'cyan' },
                invoiced: { label: 'Facturado', color: 'blue' },
                paid: { label: 'Pagado', color: 'green' },
                overdue: { label: 'Vencido', color: 'red' }
              };
              const item = statusMap[v] || { label: v, color: 'default' };
              return <Tag color={item.color}>{item.label}</Tag>;
            }
          },
          ...(canViewBilling ? [{
            title: 'Monto',
            dataIndex: 'amount',
            render: (v: number, r: Row) => `${r.currency || 'CLP'} ${Number(v).toLocaleString('es-CL')}`
          }] : []),
          ...(canManage ? [{
            title: 'Acciones',
            key: 'actions',
            render: (_: any, r: Row) => (
              r.status === 'pending' || (r.status === 'overdue' && !r.invoiced_at) ? (
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<CheckCircleOutlined />}
                  onClick={() => setCompleteMilestoneTarget(r)}
                >
                  Marcar cumplido
                </Button>
              ) : null
            )
          }] : [])
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No hay hitos de pago registrados" />}
      </Card>
      <Card title="Facturas y pagos">
        {invoices.length ? <Table size="small" rowKey="id" pagination={false} dataSource={invoices} columns={[
          { title: 'Factura', dataIndex: 'invoice_number' },
          { title: 'Vencimiento', dataIndex: 'due_date', render: (v: string) => dayjs(v).format('DD MMM YYYY') },
          {
            title: 'Estado',
            dataIndex: 'status',
            render: (v: string) => {
              const invStatusMap: Record<string, { label: string; color: string }> = {
                draft: { label: 'Borrador', color: 'default' },
                issued: { label: 'Emitida', color: 'gold' },
                partially_paid: { label: 'Pago parcial', color: 'orange' },
                paid: { label: 'Pagada', color: 'green' },
                overdue: { label: 'Vencida', color: 'red' },
                cancelled: { label: 'Anulada', color: 'default' }
              };
              const item = invStatusMap[v] || { label: v, color: 'gold' };
              return <Tag color={item.color}>{item.label}</Tag>;
            }
          },
          ...(canViewBilling ? [{ title: 'Total', dataIndex: 'total_amount', render: (v: number, r: Row) => `${r.currency || 'CLP'} ${Number(v).toLocaleString('es-CL')}` }] : []),
          ...(canViewBilling ? [{ title: 'Pagos', dataIndex: 'payments', render: (v: Row[]) => v?.length || 0 }] : [])
        ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Todavía no hay facturas asociadas" />}
      </Card>
    </div>
  </div>;

  const capacityContent = <div className="commercial-workspace">
    <div className="commercial-kpis">
      <Statistic title="Personas asignadas" value={capacity.length} prefix={<TeamOutlined />} />
      <Statistic title="FTE planificado" value={capacity.reduce((sum, row) => sum + Number(row.planned_fte || 0), 0)} precision={2} />
    </div>
    {!project.assigned_to && <Alert type="warning" showIcon message="Falta asignar un responsable de ejecución al proyecto" style={{ marginBottom: 12 }} />}
    <Card
      title="Dedicación y horas presupuestadas"
      extra={canManage ? (
        <Space>
          {isLead && (
            <Button icon={<TeamOutlined />} onClick={() => setTeamEditorOpen(true)}>
              {capacity.length ? 'Gestión masiva' : 'Asignar equipo'}
            </Button>
          )}
          <Button type="primary" icon={<UserAddOutlined />} onClick={() => openAssignModal()}>
            Asignar persona
          </Button>
        </Space>
      ) : null}
    >
      <Table size="small" rowKey="user_id" loading={loading} pagination={false} dataSource={capacity} columns={[
        { title: 'Persona', dataIndex: 'full_name' },
        { title: 'Rol', dataIndex: 'role' },
        { title: 'Asignación', dataIndex: 'allocation_percentage', render: (v: number) => `${Number(v || 0)}%` },
        { title: 'FTE', dataIndex: 'planned_fte', render: (v: number) => Number(v || 0).toFixed(2) },
        { title: 'Horas presupuestadas', dataIndex: 'budgeted_hours', render: (v: number) => v == null ? 'Por definir' : `${Number(v).toLocaleString('es-CL')} h` },
        { title: 'Horas aprobadas', dataIndex: 'actual_hours', render: (v: number) => `${Number(v || 0).toLocaleString('es-CL')} h` },
        { title: 'Periodo', render: (_: unknown, row: Row) => `${row.start_date || 'Sin inicio'} — ${row.end_date || 'Sin término'}` },
        ...(canManage ? [{
          title: 'Acciones',
          key: 'actions',
          render: (_: any, r: Row) => (
            <Space size="small">
              <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openAssignModal(r)}>
                Editar
              </Button>
              <Popconfirm
                title="¿Desasignar del proyecto?"
                description={`Se removerá a ${r.full_name || 'este integrante'} de las asignaciones.`}
                okText="Desasignar"
                cancelText="Cancelar"
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDeleteCapacity(r.user_id)}
              >
                <Button size="small" type="link" danger icon={<DeleteOutlined />}>
                  Desasignar
                </Button>
              </Popconfirm>
            </Space>
          )
        }] : [])
      ]} />
      <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
        El FTE representa la dedicación asignada (100% = 1.00 FTE). La planificación de ausencias no está incluida en esta versión.
      </Text>
    </Card>
  </div>;

  return <>
    {teamEditorOpen && <ProjectTeamEditor projectId={project.id} responsibleId={project.assigned_to || undefined}
      onClose={() => setTeamEditorOpen(false)} onSaved={() => { setTeamEditorOpen(false); void load(); onRefresh?.(); }} />}
    <FilePreviewModal fileId={previewFileId} onClose={() => setPreviewFileId(null)} />
    <Tabs className="commercial-inner-tabs" activeKey={activeTab} onChange={(tab) => { setActiveTab(tab); onTabChange?.(tab); }} items={[
      { key: 'commercial', label: 'Oportunidad y cotización', children: commercialContent },
      { key: 'delivery', label: 'Contratos y cierre', children: deliveryContent },
      { key: 'capacity', label: 'Equipo y capacidad', children: capacityContent },
      { key: 'billing', label: 'Cobranza', children: billingContent }
    ]} />
    <Modal title="Registrar reunión" open={meetingOpen} footer={null} onCancel={() => setMeetingOpen(false)} destroyOnClose>
      <Form layout="vertical" onFinish={logMeeting} initialValues={{ meeting_date: dayjs() }}>
        <Form.Item label="Fecha" name="meeting_date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} showTime /></Form.Item>
        <Form.Item label="Resultado y necesidades identificadas" name="summary" rules={[{ required: true, message: 'Describe el resultado' }]}><Input.TextArea rows={3} /></Form.Item>
        <Form.Item label="Motivo del seguimiento (desde la segunda reunión)" name="escalation_reason"><Input.TextArea rows={2} placeholder="Información pendiente, decisión o causa de demora" /></Form.Item>
        <Form.Item label="Próximo compromiso (desde la segunda reunión)" name="next_commitment"><Input.TextArea rows={2} placeholder="Responsable y fecha comprometida" /></Form.Item>
        <Form.Item name="has_pdd" valuePropName="checked"><Checkbox>Se obtuvo PDD</Checkbox></Form.Item>
        <Form.Item name="has_technical_commercial_proposal" valuePropName="checked"><Checkbox>Se obtuvo propuesta técnico comercial</Checkbox></Form.Item>
        <Form.Item label="Referencia del PDD o propuesta" name="evidence_reference"><Input placeholder="Archivo, acta o referencia" /></Form.Item>
        <Button type="primary" htmlType="submit" block>Guardar reunión</Button>
      </Form>
    </Modal>
    <Modal title="Nueva versión de cotización" open={quoteOpen} footer={null} onCancel={() => setQuoteOpen(false)} destroyOnClose>
      <Form form={quoteForm} layout="vertical" onFinish={createQuote} initialValues={{ pricing_model: 'fixed', currency: project.currency || 'CLP' }}>
        <Form.Item label="Modelo de precio" name="pricing_model"><Select options={[{ value: 'fixed', label: 'Precio fijo' }, { value: 'hourly', label: 'Por horas' }, { value: 'mixed', label: 'Mixta' }]} /></Form.Item>
        <Space style={{ width: '100%' }} align="start">
          <Form.Item label="Precio de venta" name="amount" rules={[{ required: true }]}><InputNumber min={0} style={{ width: 190 }} /></Form.Item>
          <Form.Item label="Moneda" name="currency"><Select style={{ width: 100 }} options={['CLP', 'UF', 'USD'].map((value) => ({ value }))} /></Form.Item>
        </Space>
        <Space style={{ width: '100%' }} align="start">
        <Form.Item label="Horas estimadas" name="hours"><InputNumber min={0} style={{ width: 190 }} /></Form.Item>
        {isLead && <Form.Item label="Costo estimado (interno)" name="estimated_cost"><InputNumber min={0} style={{ width: 190 }} /></Form.Item>}
        </Space>
        {isLead && <Button style={{ marginBottom: 16 }} onClick={() => void estimateQuoteCost()}>Estimar costo según equipo y horas</Button>}
        <Form.Item label="Cambio de alcance asociado" name="scope_change_id"><Select allowClear placeholder="Solo si esta versión cotiza un cambio" options={scopeChanges.filter((change) => change.requires_re_quote && !change.quote_approved && change.status === 'pending').map((change) => ({ value: change.id, label: change.description }))} /></Form.Item>
        <Form.Item label="Notas de versión" name="notes"><Input.TextArea rows={3} /></Form.Item>
        <FileManager entity_type="project" entity_id={project.id} title="Adjuntar propuesta" association_type={`quote_v${quotes.length + 1}`} showUploadTab multiple={false} maxFiles={1} />
        <Button type="primary" htmlType="submit" block>Guardar versión</Button>
      </Form>
    </Modal>
    <Modal title="Registrar evidencia de aprobación del cliente" open={approvalOpen} footer={null} onCancel={() => setApprovalOpen(false)} destroyOnClose>
      <Form layout="vertical" onFinish={async (values) => { const done = await save(`${base}/client-approval`, values, 'Aprobación del cliente registrada'); if (done) setApprovalOpen(false); }}>
        <Form.Item label="Referencia de aprobación" name="approval_reference" rules={[{ required: true, message: 'Ingresa un correo, acta o referencia' }]}><Input placeholder="Correo del cliente, acta o número de aprobación" /></Form.Item>
        <Form.Item label="Notas" name="approval_notes"><Input.TextArea rows={3} /></Form.Item>
        <Button type="primary" htmlType="submit" block>Confirmar aprobación</Button>
      </Form>
    </Modal>
    <Modal title="Aprobación del cliente para el cambio de alcance" open={scopeQuoteId !== null} footer={null} onCancel={() => setScopeQuoteId(null)} destroyOnClose>
      <Form layout="vertical" onFinish={async (values) => { const done = await save(`/commercial/quotes/${scopeQuoteId}/approve`, values, 'Cotización del cambio aprobada'); if (done) setScopeQuoteId(null); }}>
        <Form.Item label="Referencia de aprobación del cliente" name="approval_reference" rules={[{ required: true }]}><Input placeholder="Correo, acta o aprobación registrada" /></Form.Item>
        <Form.Item label="Notas" name="approval_notes"><Input.TextArea rows={3} /></Form.Item>
        <Button type="primary" htmlType="submit" block>Confirmar y aprobar versión</Button>
      </Form>
    </Modal>
    <Modal title="Registrar documento" open={Boolean(documentType)} footer={null} onCancel={() => setDocumentType(null)} destroyOnClose>
      <Form layout="vertical" onFinish={recordDocument}>
        <Form.Item label="Tipo" required><Input disabled value={({ purchase_order: 'Orden de compra', service_acceptance: 'HES / aceptación de servicio', client_approval: 'Aprobación cliente', pdd: 'PDD', technical_commercial_proposal: 'Propuesta técnico comercial' } as Row)[documentType || ''] || documentType || ''} /></Form.Item>
        <Form.Item label="Número o referencia" name="reference_number"><Input placeholder="Número OC/HES o referencia del correo" /></Form.Item>
        <Form.Item label="Fecha del documento" name="document_date"><DatePicker style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="Evidencia / notas" name="notes" rules={[{ required: true, message: 'Describe la evidencia registrada' }]}><Input.TextArea rows={3} /></Form.Item>
        <FileManager entity_type="project" entity_id={project.id} title="Adjuntar evidencia" association_type={documentType || 'commercial_evidence'} showUploadTab multiple={false} maxFiles={1} />
        <Button type="primary" htmlType="submit" block>Guardar documento</Button>
      </Form>
    </Modal>
    <Modal
      title="Marcar hito de pago como cumplido"
      open={Boolean(completeMilestoneTarget)}
      onCancel={() => { setCompleteMilestoneTarget(null); setCompleteNotes(''); }}
      onOk={handleConfirmCompleteMilestone}
      confirmLoading={completing}
      okText="Confirmar y pasar a facturable"
      cancelText="Cancelar"
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <p><strong>Hito:</strong> {completeMilestoneTarget?.name}</p>
        <p><strong>Monto:</strong> {completeMilestoneTarget?.currency || 'CLP'} {Number(completeMilestoneTarget?.amount || 0).toLocaleString('es-CL')}</p>
        <Alert
          type="info"
          showIcon
          message="Pase a facturación"
          description="Al confirmar, este hito cambiará su estado a 'Listo para facturar'. Se notificará automáticamente in-app y por correo electrónico al equipo de Facturación y Cobranza para que puedan proceder a emitir la factura correspondiente."
          style={{ marginTop: 12 }}
        />
      </div>
      <div>
        <Text strong>Observaciones o notas de entrega (opcional):</Text>
        <Input.TextArea
          rows={3}
          value={completeNotes}
          onChange={(e) => setCompleteNotes(e.target.value)}
          placeholder="Ej: Entrega aprobada por el cliente vía correo / Acta UAT firmada..."
          style={{ marginTop: 8 }}
        />
      </div>
    </Modal>
    <Modal
      title={editingCapacity ? `Editar asignación: ${editingCapacity.full_name}` : 'Asignar persona al proyecto'}
      open={capacityModalOpen}
      footer={null}
      onCancel={() => setCapacityModalOpen(false)}
      destroyOnClose
    >
      <Form
        form={capacityForm}
        layout="vertical"
        onFinish={handleSaveCapacity}
      >
        <Form.Item
          label="Integrante del equipo"
          name="user_id"
          rules={[{ required: true, message: 'Selecciona una persona' }]}
        >
          <Select
            placeholder="Selecciona persona"
            disabled={Boolean(editingCapacity)}
            showSearch
            optionFilterProp="label"
            options={teamUsers.map(u => ({
              value: u.id,
              label: `${u.full_name} (${u.role})`
            }))}
          />
        </Form.Item>
        <Form.Item
          label="Rol en el proyecto"
          name="role"
          rules={[{ required: true, message: 'Especifica el rol' }]}
        >
          <Select
            placeholder="Selecciona o escribe el rol"
            options={[
              { value: 'Desarrollador RPA', label: 'Desarrollador RPA' },
              { value: 'Arquitecto RPA', label: 'Arquitecto RPA' },
              { value: 'Tech Lead', label: 'Tech Lead' },
              { value: 'QA Engineer', label: 'QA Engineer' },
              { value: 'Project Manager', label: 'Project Manager' },
              { value: 'Business Analyst', label: 'Business Analyst' }
            ]}
          />
        </Form.Item>
        <Space style={{ width: '100%' }} align="start">
          <Form.Item
            label="% Asignación"
            name="allocation_percentage"
            rules={[{ required: true, message: 'Ingresa el porcentaje' }]}
            extra="100% = 1.00 FTE"
          >
            <InputNumber min={1} max={200} style={{ width: 140 }} addonAfter="%" />
          </Form.Item>
          <Form.Item
            label="Horas presupuestadas"
            name="budgeted_hours"
            extra="Opcional"
          >
            <InputNumber min={0} style={{ width: 160 }} addonAfter="h" placeholder="Ej: 160" />
          </Form.Item>
        </Space>
        <Form.Item
          label="Periodo de asignación"
          name="dates"
        >
          <DatePicker.RangePicker style={{ width: '100%' }} format="DD MMM YYYY" />
        </Form.Item>
        <Button type="primary" htmlType="submit" block loading={savingCapacity}>
          {editingCapacity ? 'Actualizar asignación' : 'Asignar al proyecto'}
        </Button>
      </Form>
    </Modal>
    <Modal
      title="Configurar Imputación por Centro de Costo (CECO)"
      open={costCenterModalOpen}
      onCancel={() => setCostCenterModalOpen(false)}
      onOk={handleSaveCostCenters}
      confirmLoading={savingAllocations}
      width={860}
      okText="Guardar Imputación"
      cancelText="Cancelar"
      destroyOnClose
    >
      <CostCenterDistributionPicker
        totalAmount={
          Number(
            quotes.find((q) => q.status === 'approved')?.amount ||
            quotes[0]?.amount ||
            project.sale_price ||
            project.budget ||
            0
          )
        }
        currency={
          quotes.find((q) => q.status === 'approved')?.currency ||
          quotes[0]?.currency ||
          project.currency ||
          'CLP'
        }
        allocations={Array.isArray(editingAllocations) ? editingAllocations : []}
        onChange={(val) => setEditingAllocations(Array.isArray(val) ? val : [])}
        bordered={false}
      />
    </Modal>
  </>;
};
