import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert, Card, Row, Col, Statistic, Table, Tag, Tabs, Button, Space, Select, Descriptions,
  Modal, Form, Input, InputNumber, DatePicker, message, Empty, Typography, theme
} from 'antd';
import { PlusOutlined, DownloadOutlined, DollarOutlined, FileTextOutlined, StarFilled } from '@ant-design/icons';
import apiService from '../../services/api';
import { useAuthStore } from '@/store/authStore';
import { BillingDashboard, BillingDashboardRow, PaymentMilestone, Invoice } from '../../types/billing';
import { ConfirmAction } from '@/components/common';
import { CostCenter } from '@/types/costCenter';
import CostCenterTag from '@/components/costCenters/CostCenterTag';
import { CostCenterSummaryPanel } from '@/components/billing/CostCenterSummaryPanel';

const STATUS_COLOR: Record<string, string> = {
  pending: 'default',
  billable: 'blue',
  invoiced: 'gold',
  paid: 'green',
  overdue: 'red'
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  billable: 'Por facturar',
  invoiced: 'Facturado',
  paid: 'Pagado',
  overdue: 'Vencido'
};

const CURRENCY_OPTIONS = [
  { value: 'CLP', label: 'CLP' },
  { value: 'USD', label: 'USD' },
  { value: 'UF', label: 'UF' }
];

const BillingPage: React.FC = () => {
  const { token } = theme.useToken();
  const isDark = typeof document !== 'undefined' && (
    document.documentElement.dataset.theme === 'dark' ||
    token.colorBgBase === '#0F0F10' ||
    token.colorBgContainer === '#171718' ||
    token.colorBgElevated === '#262626'
  );

  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [commercialProjects, setCommercialProjects] = useState<any[]>([]);
  const [quotes, setQuotes] = useState<any[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [projectFilter, setProjectFilter] = useState<number | undefined>(undefined);
  const [costCenterFilter, setCostCenterFilter] = useState<number | undefined>(undefined);
  const [rpaOnlyFilter, setRpaOnlyFilter] = useState<boolean>(false);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const requestedStatus = searchParams.get('status') || undefined;
  const [currencyFilter, setCurrencyFilter] = useState<string | undefined>(undefined);
  const [clientFilter, setClientFilter] = useState<string | undefined>(undefined);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [dashboard, setDashboard] = useState<BillingDashboard | null>(null);
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  // Nuevo hito de pago
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [projectMilestones, setProjectMilestones] = useState<{ id: number; name: string }[]>([]);
  const watchedProjectId = Form.useWatch('project_id', form);
  const watchedTriggerType = Form.useWatch('trigger_type', form);

  // Facturación de hitos seleccionados
  const [selectedMilestoneIds, setSelectedMilestoneIds] = useState<React.Key[]>([]);
  const [invoiceModalOpen, setInvoiceModalOpen] = useState(false);
  const [invoiceForm] = Form.useForm();

  // Registro de pago sobre una factura
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);
  const [paymentForm] = Form.useForm();
  const [dashboardError, setDashboardError] = useState(false);
  const [filters, setFilters] = useState({ period: null as [any, any] | null });
  const requestedProject = Number(searchParams.get('project_id'));
  const canManageBilling = user?.role === 'team_lead' || user?.role === 'billing';

  const goToProject = (projectId: number, tab = 'commercial') => navigate(`/projects/${projectId}?tab=${tab}`);
  const formatMoney = (amount: number, currency: string) => `${Number(amount || 0).toLocaleString('es-CL')} ${currency}`;
  const formatDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('es-CL') : 'Sin fecha';
  const filterByPeriod = (date?: string | null) => !filters.period || !date || ((!filters.period[0] || date.slice(0, 10) >= filters.period[0].format('YYYY-MM-DD')) && (!filters.period[1] || date.slice(0, 10) <= filters.period[1].format('YYYY-MM-DD')));
  const visibleMilestones = milestones.filter((row) =>
    (!statusFilter || row.status === statusFilter) &&
    (!currencyFilter || row.currency === currencyFilter) &&
    (!costCenterFilter || row.cost_center_id === costCenterFilter) &&
    (!rpaOnlyFilter || row.cost_center_is_rpa) &&
    filterByPeriod(row.planned_date)
  );
  const visibleInvoices = invoices.filter((row) => (!statusFilter || (statusFilter === 'invoiced' ? row.status === 'issued' || row.status === 'partially_paid' : row.status === statusFilter)) && (!currencyFilter || row.currency === currencyFilter) && (!clientFilter || row.client_name === clientFilter) && filterByPeriod(row.due_date));
  const visibleQuotes = quotes.filter((row) => !projectFilter || row.project_id === projectFilter)
    .filter((row) => !currencyFilter || row.currency === currencyFilter)
    .filter((row) => !statusFilter || row.status === statusFilter)
    .filter((row) => filterByPeriod(row.created_at))
    .filter((row) => !clientFilter || row.client_name === clientFilter);
  const selectedMilestones = useMemo(() => milestones.filter((m) => selectedMilestoneIds.includes(m.id)), [milestones, selectedMilestoneIds]);
  const selectedAllFromOneProject = new Set(selectedMilestones.map((row) => row.project_id)).size <= 1;
  const tabKey = searchParams.get('tab') || 'overview';
  const setTab = (key: string) => {
    if (key === 'overview') searchParams.delete('tab');
    else searchParams.set('tab', key);
    setSearchParams(searchParams, { replace: true });
  };

  useEffect(() => {
    apiService.getCostCenters({ active_only: true })
      .then((res) => {
        const list = Array.isArray(res) ? res : (res as any)?.data || [];
        setCostCenters(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        console.error('Error al cargar centros de costo:', err);
        setCostCenters([]);
      });
  }, []);

  useEffect(() => {
    apiService.getProjects().then(p => {
      setProjects(p.map((x: any) => ({ id: x.id, name: x.name })));
      const relevantProjects = p.filter((x: any) => x.project_type === 'commercial' || x.client_id).map((x: any) => ({ id: x.id, name: x.name, client_name: x.client_name }));
      setCommercialProjects(relevantProjects);
      if (Number.isInteger(requestedProject) && requestedProject > 0) setProjectFilter(requestedProject);
    }).catch(() => message.error('No se pudo cargar la lista de proyectos'));
  }, [requestedProject]);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilter, costCenterFilter, rpaOnlyFilter]);

  useEffect(() => {
    if (requestedStatus) setStatusFilter(requestedStatus);
  }, [requestedStatus]);

  // Carga los hitos del proyecto (Gantt) para poblar el selector de "hito de proyecto"
  // cuando el disparador del hito de pago requiere uno (progress_pct / deliverable_approved)
  // y pre-selecciona el CECO principal asignado al proyecto si existe.
  useEffect(() => {
    if (createModalOpen && watchedProjectId) {
      apiService.getProjectGantt?.(watchedProjectId)
        ?.then(res => setProjectMilestones((res.milestones || []).map((m: any) => ({ id: m.id, name: m.name }))))
        .catch(() => setProjectMilestones([]));

      apiService.getProjectCostCenters?.(watchedProjectId)
        ?.then(res => {
          const allocs = res?.allocations || [];
          if (allocs.length > 0 && !form.getFieldValue('cost_center_id')) {
            const sorted = [...allocs].sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0));
            form.setFieldsValue({
              cost_center_id: sorted[0].cost_center_id,
              currency: res.currency || form.getFieldValue('currency') || 'CLP'
            });
          }
        })
        .catch(() => {});
    } else {
      setProjectMilestones([]);
    }
  }, [watchedProjectId, createModalOpen, form]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [dash, ms, inv] = await Promise.all([
        apiService.getBillingDashboard(projectFilter),
        apiService.getPaymentMilestones(projectFilter, {
          cost_center_id: costCenterFilter,
          rpa_only: rpaOnlyFilter,
        }),
        apiService.getInvoices(projectFilter)
      ]);
      setDashboard(dash);
      setMilestones(ms);
      setInvoices(inv);
      setDashboardError(false);
    } catch (error) {
      setDashboardError(true);
      message.error('Error al cargar datos de cobranza');
    } finally {
      setLoading(false);
    }
  };

  const projectsForCommercial = commercialProjects;

  const filteredReadyToInvoice = (dashboard?.ready_to_invoice || []).filter((row) => (!projectFilter || row.project_id === projectFilter) && (!currencyFilter || row.currency === currencyFilter) && (!statusFilter || statusFilter === 'billable') && filterByPeriod(row.planned_date));
  const filteredOverdue = (dashboard?.overdue || []).filter((row) => (!projectFilter || row.project_id === projectFilter) && (!currencyFilter || row.currency === currencyFilter) && (!statusFilter || statusFilter === 'overdue') && filterByPeriod(row.planned_date));
  const filteredOverdueInvoices = visibleInvoices.filter((row) => row.status === 'overdue');

  useEffect(() => {
    if (projectsForCommercial.length === 0) return;
    let cancelled = false;
    Promise.allSettled(projectsForCommercial.map(async (project: any) => {
      const response = await apiService.request({ url: `/commercial/projects/${project.id}/quotes` });
      const rows = response?.data?.data ?? response?.data ?? [];
      return Array.isArray(rows) ? rows.map((quote: any) => ({ ...quote, project_id: project.id, project_name: project.name, client_name: project.client_name })) : [];
    })).then((results) => {
      if (!cancelled) setQuotes(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []));
    });
    return () => { cancelled = true; };
  }, [projectsForCommercial]);

  const handleCreateMilestone = async (values: any) => {
    try {
      const payload: any = {
        project_id: values.project_id,
        cost_center_id: values.cost_center_id || undefined,
        name: values.name,
        description: values.description,
        amount: values.amount,
        currency: values.currency,
        trigger_type: values.trigger_type
      };

      if (values.trigger_type === 'date') {
        payload.planned_date = values.planned_date ? values.planned_date.format('YYYY-MM-DD') : undefined;
      } else {
        payload.project_milestone_id = values.project_milestone_id;
        if (values.trigger_type === 'progress_pct') {
          payload.trigger_value = values.trigger_value;
        }
        if (values.planned_date) {
          payload.planned_date = values.planned_date.format('YYYY-MM-DD');
        }
      }

      await apiService.createPaymentMilestone(payload);
      message.success('Hito de pago creado');
      setCreateModalOpen(false);
      form.resetFields();
      loadAll();
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || 'Error al crear el hito de pago');
    }
  };

  const handleDeleteMilestone = async (id: number) => {
    try {
      await apiService.deletePaymentMilestone(id);
      message.success('Hito eliminado');
      loadAll();
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || 'No se pudo eliminar (¿ya no está pendiente?)');
    }
  };

  const handleDownloadStatement = async (projectId: number) => {
    try {
      const blob = await apiService.downloadPaymentStatement(projectId);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `estado-pago-${projectId}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      message.error('No se pudo generar el PDF');
    }
  };

  const handleOpenInvoiceModal = () => {
    invoiceForm.resetFields();
    setInvoiceModalOpen(true);
  };

  const handleCreateInvoice = async (values: any) => {
    try {
      const projectId = selectedMilestones[0]?.project_id;
      await apiService.createInvoice({
        project_id: projectId,
        invoice_number: values.invoice_number,
        issue_date: values.issue_date.format('YYYY-MM-DD'),
        due_date: values.due_date.format('YYYY-MM-DD'),
        payment_milestone_ids: selectedMilestoneIds
      });
      message.success('Factura creada');
      setInvoiceModalOpen(false);
      invoiceForm.resetFields();
      setSelectedMilestoneIds([]);
      await loadAll();
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || 'Error al crear la factura');
    }
  };

  const handleOpenPaymentModal = (invoice: Invoice) => {
    const paid = Number(invoice.totals?.paid_amount ?? invoice.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0);
    setSelectedInvoiceForPayment(invoice);
    paymentForm.resetFields();
    paymentForm.setFieldsValue({ currency: invoice.currency, amount: Math.max(0, invoice.amount - paid) });
    setPaymentModalOpen(true);
  };

  const handleRecordPayment = async (values: any) => {
    if (!selectedInvoiceForPayment) return;
    try {
      await apiService.recordPayment(selectedInvoiceForPayment.id, {
        amount: values.amount,
        currency: values.currency,
        payment_date: values.payment_date.format('YYYY-MM-DD'),
        method: values.method || undefined,
        reference: values.reference || undefined
      });
      message.success('Pago registrado');
      const paidInvoiceId = selectedInvoiceForPayment.id;
      setPaymentModalOpen(false);
      paymentForm.resetFields();
      setSelectedInvoiceForPayment(null);
      await loadAll();
      const refreshedInvoices = await apiService.getInvoices(projectFilter);
      setInvoices(refreshedInvoices);
      setSelectedInvoice(refreshedInvoices.find((invoice) => invoice.id === paidInvoiceId) || null);
    } catch (error: any) {
      message.error(error.response?.data?.error || error.message || 'Error al registrar el pago');
    }
  };

  const milestoneColumns = [
    { title: 'Proyecto', key: 'project', render: (_: unknown, r: PaymentMilestone) => <Button type="link" onClick={() => goToProject(r.project_id, 'billing')}>{r.project_name}</Button> },
    { title: 'Origen', key: 'source', render: (_: unknown, r: PaymentMilestone) => r.project_milestone_id ? <Button type="link" onClick={() => navigate(`/pmo/gantt/${r.project_id}`)}>{r.source_milestone_name || `Hito #${r.project_milestone_id}`}</Button> : 'Fecha / condición comercial' },
    { title: 'Nombre', dataIndex: 'name', key: 'name' },
    {
      title: 'Centro de Costo',
      key: 'cost_center',
      render: (_: unknown, r: PaymentMilestone) => (
        <CostCenterTag
          code={r.cost_center_code}
          name={r.cost_center_name}
          country={r.cost_center_country}
          isRpa={r.cost_center_is_rpa}
          size="small"
        />
      ),
    },
    { title: 'Monto', key: 'amount', render: (_: unknown, r: PaymentMilestone) => formatMoney(r.amount, r.currency) },
    { title: 'Fecha planificada', dataIndex: 'planned_date', key: 'planned_date', render: formatDate },
    {
      title: 'Estado', dataIndex: 'status', key: 'status',
      render: (status: string) => <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status] || status}</Tag>
    },
    {
      title: 'Acciones', key: 'actions',
      render: (_: any, r: PaymentMilestone) => r.status === 'pending' ? (
        <ConfirmAction title="¿Eliminar este hito?" description="Esta acción no se puede deshacer." onConfirm={() => handleDeleteMilestone(r.id)}>
          <Button danger size="small">Eliminar</Button>
        </ConfirmAction>
      ) : null
    }
  ];

  const dashboardRowColumns = [
    { title: 'Proyecto', key: 'project', render: (_: unknown, r: BillingDashboardRow) => <Button type="link" onClick={() => goToProject(r.project_id, 'billing')}>{r.project_name}</Button> },
    { title: 'Hito', dataIndex: 'name', key: 'name' },
    { title: 'Monto', key: 'amount', render: (_: unknown, r: BillingDashboardRow) => <Space>{formatMoney(r.amount, r.currency)}{r.rate_missing && <Tag color="orange">Sin tipo de cambio</Tag>}</Space> },
    { title: 'Fecha', dataIndex: 'planned_date', key: 'planned_date', render: formatDate }
  ];

  const invoiceColumns = [
    { title: 'N° Factura', dataIndex: 'invoice_number', key: 'invoice_number' },
    { title: 'Cliente / proyecto', key: 'project', render: (_: unknown, r: Invoice) => <Space direction="vertical" size={0}><span>{r.client_name || 'Sin cliente asociado'}</span><Button type="link" onClick={() => goToProject(r.project_id, 'billing')}>{r.project_name}</Button></Space> },
    { title: 'Emisión', dataIndex: 'issue_date', key: 'issue_date', render: formatDate },
    { title: 'Vencimiento', dataIndex: 'due_date', key: 'due_date', render: formatDate },
    { title: 'Facturado', key: 'amount', render: (_: unknown, r: Invoice) => formatMoney(r.amount, r.currency) },
    { title: 'Recibido / saldo', key: 'balance', render: (_: unknown, r: Invoice) => { const paid = Number(r.totals?.paid_amount ?? r.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0); return `${formatMoney(paid, r.currency)} / ${formatMoney(Math.max(0, r.amount - paid), r.currency)}`; } },
    {
      title: 'Estado', dataIndex: 'status', key: 'status',
      render: (status: string) => <Tag color={STATUS_COLOR[status] || 'default'}>{STATUS_LABEL[status] || ({ issued: 'Emitida', partially_paid: 'Pago parcial', cancelled: 'Anulada', draft: 'Borrador' } as Record<string, string>)[status] || status}</Tag>
    },
    {
      title: 'Acciones', key: 'actions',
      render: (_: any, r: Invoice) => (
        <Space>
          <Button icon={<DownloadOutlined />} size="small" onClick={() => handleDownloadStatement(r.project_id)}>
            Estado de pago
          </Button>
          <Button size="small" onClick={() => setSelectedInvoice(r)}>Detalle y pagos</Button>
          {canManageBilling && r.status !== 'paid' && r.status !== 'cancelled' && (
            <Button icon={<DollarOutlined />} size="small" type="primary" onClick={() => handleOpenPaymentModal(r)}>
              Registrar pago
            </Button>
          )}
        </Space>
      )
    }
  ];

  const quoteColumns = [
    { title: 'Proyecto / cliente', key: 'project', render: (_: unknown, row: any) => <Button type="link" onClick={() => goToProject(row.project_id, 'commercial')}>{row.project_name}{row.client_name ? ` · ${row.client_name}` : ''}</Button> },
    { title: 'Versión', dataIndex: 'version', render: (version: number) => `v${version}` },
    { title: 'Cotizado', key: 'amount', render: (_: unknown, row: any) => formatMoney(row.amount, row.currency) },
    { title: 'Estado de cotización', dataIndex: 'status', render: (status: string) => <Tag color={status === 'approved' ? 'green' : status === 'replaced' ? 'default' : 'blue'}>{({ sent: 'Enviada al cliente', approved: 'Aprobada internamente', replaced: 'Reemplazada', rejected: 'Rechazada', draft: 'Borrador' } as Record<string, string>)[status] || status}</Tag> },
    { title: 'Aprobación cliente', key: 'client-approval', render: (_: unknown, row: any) => row.client_approval_recorded_at ? <Tag color="green">Registrada · {formatDate(row.client_approval_recorded_at)}</Tag> : <Tag>Sin registrar</Tag> },
    { title: 'Versión creada', dataIndex: 'created_at', render: formatDate }
  ];

  return (
    <div className="page-container">
      <Card
        title={<span><FileTextOutlined /> Finanzas y cobranza</span>}
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="Todos los proyectos"
              style={{ width: 240 }}
              value={projectFilter}
              onChange={setProjectFilter}
              options={projects.map(p => ({ value: p.id, label: p.name }))}
            />
            <Select allowClear placeholder="Todos los clientes" style={{ width: 200 }} value={clientFilter} options={[...new Set(commercialProjects.map((project) => project.client_name).filter(Boolean))].map((name) => ({ value: name, label: name }))} onChange={setClientFilter} />
            <Select allowClear placeholder="Todos los estados" style={{ width: 175 }} value={statusFilter} onChange={setStatusFilter} options={[
              { value: 'pending', label: 'Pendiente' }, { value: 'billable', label: 'Por facturar' }, { value: 'invoiced', label: 'Facturado' },
              { value: 'issued', label: 'Emitida' }, { value: 'partially_paid', label: 'Pago parcial' }, { value: 'paid', label: 'Pagado' }, { value: 'overdue', label: 'Vencido' },
              { value: 'sent', label: 'Cotización enviada' }, { value: 'approved', label: 'Cotización aprobada' }, { value: 'replaced', label: 'Cotización reemplazada' }
            ]} />
            <Select allowClear placeholder="Todas las monedas" style={{ width: 155 }} value={currencyFilter} onChange={setCurrencyFilter} options={CURRENCY_OPTIONS} />
            <Button
              size="middle"
              type={rpaOnlyFilter ? 'primary' : 'default'}
              icon={<StarFilled style={{ color: rpaOnlyFilter ? '#fff' : '#faad14' }} />}
              onClick={() => {
                setRpaOnlyFilter(!rpaOnlyFilter);
                if (!rpaOnlyFilter) setCostCenterFilter(undefined);
              }}
            >
              ⭐ Mis CECOs RPA
            </Button>
            <Select
              allowClear
              placeholder="Centro de Costo"
              style={{ width: 175 }}
              value={costCenterFilter}
              onChange={setCostCenterFilter}
              showSearch
              filterOption={(input, option) =>
                String(option?.label || '').toLowerCase().includes(input.toLowerCase())
              }
              options={(Array.isArray(costCenters) ? costCenters : []).map((c) => ({
                value: c.id,
                label: `${c.code} - ${c.name}`,
              }))}
            />
            <DatePicker.RangePicker value={filters.period as any} onChange={(period) => setFilters((current) => ({ ...current, period: period as [any, any] | null }))} aria-label="Periodo de cobranza" />
            {canManageBilling && <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              if (projectFilter) {
                form.setFieldsValue({ project_id: projectFilter });
              }
              setCreateModalOpen(true);
            }}>
              Nuevo hito de pago
            </Button>}
          </Space>
        }
      >
        <Typography.Paragraph type="secondary">Valores mostrados en su moneda de origen. Fecha de corte: {new Date().toLocaleDateString('es-CL')}. Los totales solo se muestran separados por moneda; no se convierten ni mezclan.</Typography.Paragraph>
        {dashboardError && <Alert type="error" showIcon message="No fue posible cargar la cobranza" description="Revisa la conexión y vuelve a cargar la página." />}
        <Tabs
          activeKey={tabKey}
          onChange={setTab}
          items={[
            {
              key: 'overview',
              label: 'Resumen y cuentas por cobrar',
              children: (
                <>
                  <Row gutter={[12, 12]} style={{ marginBottom: 18 }}>
                    <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Pendientes o próximos" value={visibleMilestones.filter((row) => row.status === 'pending' || row.status === 'billable').length + visibleInvoices.filter((row) => row.status === 'issued' || row.status === 'partially_paid').length} /></Card></Col>
                    <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Listo para facturar" value={filteredReadyToInvoice.length} /></Card></Col>
                    <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Facturas vencidas" value={visibleInvoices.filter((row) => row.status === 'overdue').length} valueStyle={{ color: 'var(--color-error)' }} /></Card></Col>
                    <Col xs={24} sm={12} lg={6}><Card size="small"><Statistic title="Facturas pagadas" value={visibleInvoices.filter((row) => row.status === 'paid').length} valueStyle={{ color: 'var(--color-success)' }} /></Card></Col>
                  </Row>
                  {filteredOverdueInvoices.length > 0 && <Alert showIcon type="error" message={`${filteredOverdueInvoices.length} factura(s) vencidas requieren seguimiento`} description="Revisa saldo y último pago en la pestaña Facturas y pagos." style={{ marginBottom: 14 }} />}
                  {dashboardError ? <Empty description="No hay datos disponibles debido a un error de carga" /> : <>
                    <Card title="Siguiente acción: lista para facturar" size="small" style={{ marginBottom: 14 }}>
                  <Table dataSource={filteredReadyToInvoice} columns={dashboardRowColumns} rowKey="id" loading={loading} pagination={{ pageSize: 6 }} locale={{ emptyText: 'No hay hitos listos para facturar en este filtro' }} />
                    </Card>
                    <Card title="Facturas con saldo pendiente" size="small" style={{ marginBottom: 14 }}>
                  <Table dataSource={visibleInvoices.filter((row) => row.status !== 'paid' && row.status !== 'cancelled')} columns={invoiceColumns} rowKey="id" loading={loading} pagination={{ pageSize: 6 }} locale={{ emptyText: 'No hay facturas abiertas en este filtro' }} />
                    </Card>
                    <Card title="Hitos vencidos" size="small">
                      <Table dataSource={filteredOverdue} columns={dashboardRowColumns} rowKey="id" loading={loading} pagination={{ pageSize: 6 }} locale={{ emptyText: 'No hay hitos vencidos en este filtro' }} />
                    </Card>
                  </>}
                </>
              )
            },
            {
              key: 'quotes',
              label: 'Cotizaciones',
              children: <>
                <Alert type="info" showIcon message="Aprobaciones diferenciadas" description="La validación interna de una versión no representa aprobación del cliente. La aprobación del cliente se registra por separado en la ficha del proyecto." style={{ marginBottom: 14 }} />
                <Table dataSource={visibleQuotes} columns={quoteColumns} rowKey="id" loading={loading} pagination={{ pageSize: 8 }} locale={{ emptyText: loading ? 'Cargando cotizaciones…' : 'No hay cotizaciones en el filtro seleccionado' }} />
              </>
            },
            {
              key: 'milestones',
              label: 'Hitos cobrables',
              children: (
                <>
                  <Space style={{ marginBottom: 12 }}>
                    <Button
                      type="primary"
                      disabled={selectedMilestoneIds.length === 0 || !selectedAllFromOneProject}
                      onClick={handleOpenInvoiceModal}
                    >
                      Facturar seleccionados ({selectedMilestoneIds.length})
                    </Button>
                    {!selectedAllFromOneProject && <Typography.Text type="danger">Selecciona hitos de un solo proyecto por factura.</Typography.Text>}
                  </Space>
                  <Table
                    dataSource={visibleMilestones}
                    columns={milestoneColumns}
                    rowKey="id"
                    loading={loading}
                    locale={{ emptyText: loading ? 'Cargando hitos…' : 'No hay hitos en este filtro' }}
                    rowSelection={{
                      selectedRowKeys: selectedMilestoneIds,
                      onChange: (keys) => setSelectedMilestoneIds(keys),
                      getCheckboxProps: (record: PaymentMilestone) => ({ disabled: record.status !== 'billable' })
                    }}
                  />
                </>
              )
            },
            {
              key: 'invoices',
              label: 'Facturas y pagos',
              children: <Table dataSource={visibleInvoices} columns={invoiceColumns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} locale={{ emptyText: loading ? 'Cargando facturas…' : 'No hay facturas en este filtro' }} />
            },
            {
              key: 'cost-centers',
              label: 'Imputación por CECO',
              children: <CostCenterSummaryPanel projectId={projectFilter} />
            }
          ]}
        />
      </Card>

      <Modal
        title="Nuevo hito de pago"
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onOk={() => form.submit()}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleCreateMilestone}>
          <Form.Item name="project_id" label="Proyecto" rules={[{ required: true }]}>
            <Select options={projects.map(p => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="cost_center_id" label="Centro de Costo (CECO)">
            <Select
              allowClear
              placeholder="Seleccionar Centro de Costo (Opcional)"
              showSearch
              filterOption={(input, option) =>
                String(option?.label || '').toLowerCase().includes(input.toLowerCase())
              }
              options={(Array.isArray(costCenters) ? costCenters : []).map((c) => ({
                value: c.id,
                label: `${c.code} - ${c.name} (${c.country}) ${c.is_rpa ? '⭐ RPA' : ''}`,
              }))}
            />
          </Form.Item>
          <Form.Item name="name" label="Nombre" rules={[{ required: true }]}>
            <Input placeholder="Ej: Anticipo 30%" />
          </Form.Item>
          <Form.Item name="amount" label="Monto" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={1} />
          </Form.Item>
          <Form.Item name="currency" label="Moneda" initialValue="CLP" rules={[{ required: true }]}>
            <Select options={CURRENCY_OPTIONS} />
          </Form.Item>
          <Form.Item name="trigger_type" label="Disparador" initialValue="date" rules={[{ required: true }]}>
            <Select options={[
              { value: 'date', label: 'Fecha' },
              { value: 'progress_pct', label: '% de avance' },
              { value: 'deliverable_approved', label: 'Entregable aprobado' }
            ]} />
          </Form.Item>

          {watchedTriggerType !== 'date' && (
            <Form.Item
              name="project_milestone_id"
              label="Hito de proyecto"
              rules={[{ required: true, message: 'Selecciona el hito de proyecto asociado' }]}
            >
              <Select
                placeholder={watchedProjectId ? 'Selecciona un hito del proyecto' : 'Selecciona primero un proyecto'}
                options={projectMilestones.map(m => ({ value: m.id, label: m.name }))}
              />
            </Form.Item>
          )}

          {watchedTriggerType === 'progress_pct' && (
            <Form.Item
              name="trigger_value"
              label="% de avance requerido"
              rules={[{ required: true, message: 'Ingresa el % de avance requerido' }]}
            >
              <InputNumber style={{ width: '100%' }} min={0} max={100} />
            </Form.Item>
          )}

          <Form.Item
            name="planned_date"
            label="Fecha planificada"
            rules={[{ required: watchedTriggerType === 'date', message: 'La fecha planificada es requerida' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Facturar hitos seleccionados"
        open={invoiceModalOpen}
        onCancel={() => setInvoiceModalOpen(false)}
        onOk={() => invoiceForm.submit()}
        destroyOnHidden
      >
        <div style={{ marginBottom: 16 }}>
          <p>
            Se facturarán {selectedMilestones.length} hito(s) de "{selectedMilestones[0]?.project_name || '—'}" por un total de{' '}
            <strong>{selectedMilestones.reduce((s, m) => s + m.amount, 0).toLocaleString('es-CL')} {selectedMilestones[0]?.currency}</strong>.
          </p>
          <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 8, fontWeight: 600 }}>
            Imputación por Centro de Costo en las líneas de factura:
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size={6}>
            {selectedMilestones.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : token.colorFillAlter,
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: `1px solid ${token.colorBorderSecondary}`,
                }}
              >
                <span>{m.name}</span>
                <Space>
                  <Typography.Text strong>{m.currency} {m.amount.toLocaleString('es-CL')}</Typography.Text>
                  <CostCenterTag
                    code={m.cost_center_code}
                    name={m.cost_center_name}
                    country={m.cost_center_country}
                    isRpa={m.cost_center_is_rpa}
                    size="small"
                  />
                </Space>
              </div>
            ))}
          </Space>
        </div>
        <Form form={invoiceForm} layout="vertical" onFinish={handleCreateInvoice}>
          <Form.Item name="invoice_number" label="N° de factura" rules={[{ required: true }]}>
            <Input placeholder="Ej: F-0001" />
          </Form.Item>
          <Form.Item name="issue_date" label="Fecha de emisión" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="due_date" label="Fecha de vencimiento" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`Registrar pago${selectedInvoiceForPayment ? ` - Factura ${selectedInvoiceForPayment.invoice_number}` : ''}`}
        open={paymentModalOpen}
        onCancel={() => setPaymentModalOpen(false)}
        onOk={() => paymentForm.submit()}
        destroyOnHidden
      >
        <Form form={paymentForm} layout="vertical" onFinish={handleRecordPayment}>
          <Form.Item name="amount" label={`Monto pendiente (${selectedInvoiceForPayment?.currency || ''})`} rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0.01} max={selectedInvoiceForPayment ? Math.max(0, selectedInvoiceForPayment.amount - Number(selectedInvoiceForPayment.totals?.paid_amount ?? selectedInvoiceForPayment.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0)) : undefined} />
          </Form.Item>
          <Form.Item name="currency" label="Moneda" rules={[{ required: true }]}>
            <Select disabled options={CURRENCY_OPTIONS} />
          </Form.Item>
          <Form.Item name="payment_date" label="Fecha de pago" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="method" label="Método">
            <Input placeholder="Ej: Transferencia" />
          </Form.Item>
          <Form.Item name="reference" label="Referencia">
            <Input placeholder="N° de operación" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`Detalle de factura ${selectedInvoice?.invoice_number || ''}`} open={Boolean(selectedInvoice)} onCancel={() => setSelectedInvoice(null)} footer={<Button onClick={() => setSelectedInvoice(null)}>Cerrar</Button>} width={760}>
        {selectedInvoice && <>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="Proyecto"><Button type="link" onClick={() => goToProject(selectedInvoice.project_id, 'billing')}>{selectedInvoice.project_name || `Proyecto #${selectedInvoice.project_id}`}</Button></Descriptions.Item>
            <Descriptions.Item label="Estado"><Tag color={STATUS_COLOR[selectedInvoice.status] || 'default'}>{STATUS_LABEL[selectedInvoice.status] || selectedInvoice.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="Facturado">{formatMoney(selectedInvoice.amount, selectedInvoice.currency)}</Descriptions.Item>
            <Descriptions.Item label="Recibido">{formatMoney(Number(selectedInvoice.totals?.paid_amount ?? selectedInvoice.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0), selectedInvoice.currency)}</Descriptions.Item>
            <Descriptions.Item label="Saldo pendiente">{formatMoney(Math.max(0, selectedInvoice.amount - Number(selectedInvoice.totals?.paid_amount ?? selectedInvoice.payments?.reduce((sum, payment) => sum + payment.amount, 0) ?? 0)), selectedInvoice.currency)}</Descriptions.Item>
            <Descriptions.Item label="Vence">{formatDate(selectedInvoice.due_date)}</Descriptions.Item>
          </Descriptions>
          <Typography.Title level={5} style={{ marginTop: 20 }}>Hitos incluidos</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedInvoice.lines || []} columns={[
            { title: 'Hito / concepto', dataIndex: 'description' },
            { title: 'Monto', dataIndex: 'amount', render: (amount: number) => formatMoney(amount, selectedInvoice.currency) },
            { title: 'Origen', key: 'origin', render: (_: unknown, line: any) => line.payment_milestone_id ? <Button type="link" onClick={() => { setSelectedInvoice(null); navigate(`/billing?tab=milestones&project_id=${selectedInvoice.project_id}`); }}>Hito #{line.payment_milestone_id}</Button> : 'Sin hito asociado' }
          ]} />
          <Typography.Title level={5} style={{ marginTop: 20 }}>Pagos registrados</Typography.Title>
          <Table size="small" rowKey="id" pagination={false} dataSource={selectedInvoice.payments || []} columns={[
            { title: 'Fecha', dataIndex: 'payment_date', render: formatDate }, { title: 'Monto', dataIndex: 'amount', render: (amount: number) => formatMoney(amount, selectedInvoice.currency) },
            { title: 'Método', dataIndex: 'method', render: (value: string) => value || '—' }, { title: 'Referencia', dataIndex: 'reference', render: (value: string) => value || '—' }
          ]} locale={{ emptyText: 'Aún no hay pagos registrados' }} />
        </>}
      </Modal>
    </div>
  );
};

export default BillingPage;
