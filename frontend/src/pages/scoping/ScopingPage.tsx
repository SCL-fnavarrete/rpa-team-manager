import React, { useState, useEffect, useCallback } from 'react';
import { 
  Form, 
  Row, 
  Col, 
  Tabs, 
  Typography, 
  message, 
  Modal, 
  theme 
} from 'antd';
import { 
  CalculatorOutlined, 
  HistoryOutlined, 
  CheckCircleOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { 
  ScopingInputs, 
  ScopingCalculationResult, 
  ScopingQuotationRecord, 
  RPAArchetype, 
  ScopingKpis 
} from '../../types/scoping';
import { scopingService } from '../../services/scopingService';
import { MeetingTimerHeader } from '../../components/scoping/MeetingTimerHeader';
import { DiscoveryWizard } from '../../components/scoping/DiscoveryWizard';
import { LiveScoringSidebar } from '../../components/scoping/LiveScoringSidebar';
import { TechnicalEconomicProposalModal } from '../../components/scoping/TechnicalEconomicProposalModal';
import { ScopingListTable } from '../../components/scoping/ScopingListTable';
import { ScopingArchetypeQuestionsModal } from '../../components/scoping/ScopingArchetypeQuestionsModal';

const { Title, Paragraph } = Typography;

const DEFAULT_INPUTS: ScopingInputs = {
  client_name: '',
  process_name: '',
  business_unit: '',
  client_contact: '',
  process_archetype: 'custom',

  data_input_type: 'digital_structured',
  rule_based_level: 'rules_mostly',
  process_stability: 'no_change',
  application_stability: 'no_change',

  frequency: 'daily',
  volume_per_frequency: 100,
  aht_minutes: 10,
  current_ftes: 1,
  error_rate_pct: 5,
  peak_period: 'regular_peak',

  process_steps_count: '15_25',
  decision_complexity: 'simple_yes_no',
  applications_count: '2_3_apps',
  applications_detail: 'SAP, Excel, Portales Web',
  uses_vdi: false,
  requires_ocr: false,
  structured_data_pct: 'gte_80',
  exception_rate_pct: 3,

  currency: 'CLP',
  hourly_labor_cost: 14000,
  target_hourly_rate: 36000,
  internal_cost_rate: 18000,
  status: 'draft'
};

export const ScopingPage: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const [activeMainTab, setActiveMainTab] = useState<string>('wizard');
  const [archetypes, setArchetypes] = useState<RPAArchetype[]>([]);
  const [selectedArchetype, setSelectedArchetype] = useState<RPAArchetype | undefined>();
  const [archetypeModalVisible, setArchetypeModalVisible] = useState<boolean>(false);

  // Estado del cálculo en vivo
  const [currentInputs, setCurrentInputs] = useState<ScopingInputs>(DEFAULT_INPUTS);
  const [calculation, setCalculation] = useState<ScopingCalculationResult | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Modal de propuesta formal
  const [proposalModalVisible, setProposalModalVisible] = useState<boolean>(false);
  const [savedQuoteCode, setSavedQuoteCode] = useState<string>('COT-2026-NUEVA');
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);
  const [isConverting, setIsConverting] = useState<boolean>(false);

  // Historial de cotizaciones
  const [historyItems, setHistoryItems] = useState<ScopingQuotationRecord[]>([]);
  const [kpis, setKpis] = useState<ScopingKpis>({
    total_scopings: 0,
    viable_percentage: 0,
    total_quoted_hours: 0,
    total_proposed_amount: 0
  });
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  // 1. Cargar arquetipos y calcular inicial
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const archList = await scopingService.getArchetypes();
        setArchetypes(archList);
        form.setFieldsValue(DEFAULT_INPUTS);
        triggerCalculate(DEFAULT_INPUTS);
      } catch (err) {
        console.error('Error cargando arquetipos:', err);
      }
    };
    void loadInitialData();
  }, [form]);

  // 2. Cargar historial
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await scopingService.getAll({
        search: searchFilter || undefined,
        status: statusFilter || undefined
      });
      setHistoryItems(res.data || []);
      if (res.kpis) setKpis(res.kpis);
    } catch (err) {
      console.error('Error cargando historial:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [searchFilter, statusFilter]);

  useEffect(() => {
    if (activeMainTab === 'history') {
      void loadHistory();
    }
  }, [activeMainTab, loadHistory]);

  // 3. Cálculo reactivo (debounced)
  const triggerCalculate = async (values: ScopingInputs) => {
    setIsCalculating(true);
    try {
      const result = await scopingService.calculate(values);
      setCalculation(result);
    } catch (err) {
      console.error('Error calculando cotización:', err);
    } finally {
      setIsCalculating(false);
    }
  };

  const handleFormValuesChange = (_changedValues: any, allValues: any) => {
    const merged: ScopingInputs = {
      ...currentInputs,
      ...allValues,
      uses_vdi: Boolean(allValues.uses_vdi),
      requires_ocr: Boolean(allValues.requires_ocr)
    };
    setCurrentInputs(merged);
    void triggerCalculate(merged);
  };

  // 4. Seleccionar un arquetipo
  const handleSelectArchetype = (archetype: RPAArchetype) => {
    setSelectedArchetype(archetype);
    const updated = {
      ...form.getFieldsValue(),
      process_archetype: archetype.id,
      process_name: archetype.name,
      applications_detail: archetype.typical_systems,
      ...archetype.default_inputs
    };
    form.setFieldsValue(updated);
    setCurrentInputs(updated);
    void triggerCalculate(updated);
    message.success(`Plantilla cargada: ${archetype.name}`);
  };

  // 5. Guardar cotización en la base de datos
  const handleSaveQuote = async () => {
    try {
      await form.validateFields();
    } catch {
      message.error('Por favor completa los campos requeridos antes de guardar.');
      return;
    }

    setIsSaving(true);
    try {
      const values = form.getFieldsValue();
      const payload: Partial<ScopingInputs> = {
        ...values,
        uses_vdi: Boolean(values.uses_vdi),
        requires_ocr: Boolean(values.requires_ocr),
        process_archetype: selectedArchetype?.id || values.process_archetype || 'custom'
      };

      let savedRecord: ScopingQuotationRecord;
      if (lastSavedId) {
        savedRecord = await scopingService.update(lastSavedId, payload);
        message.success(`Cotización ${savedRecord.code} actualizada exitosamente.`);
      } else {
        savedRecord = await scopingService.create(payload);
        setLastSavedId(savedRecord.id);
        setSavedQuoteCode(savedRecord.code);
        message.success(`Cotización ${savedRecord.code} guardada exitosamente.`);
      }

      setSavedQuoteCode(savedRecord.code);
      setProposalModalVisible(true);
    } catch (err: any) {
      message.error(err.message || 'Error al guardar la cotización.');
    } finally {
      setIsSaving(false);
    }
  };

  // 6. Convertir a Proyecto Formal
  const handleConvertToProject = async (idToConvert?: number) => {
    const targetId = idToConvert || lastSavedId;
    if (!targetId) {
      message.warning('Debes guardar la cotización antes de convertirla a proyecto.');
      return;
    }

    Modal.confirm({
      title: '¿Confirmar creación de Proyecto Formal?',
      icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
      content: 'Se creará automáticamente el proyecto en el portafolio con su presupuesto, tablero Kanban y las 5 fases metodológicas de RPA asignadas como tareas.',
      okText: 'Crear Proyecto',
      cancelText: 'Cancelar',
      onOk: async () => {
        setIsConverting(true);
        try {
          const res = await scopingService.convertToProject(targetId);
          message.success('Proyecto formal creado exitosamente.');
          setProposalModalVisible(false);
          navigate(`/projects/${res.project_id}`);
        } catch (err: any) {
          message.error(err.message || 'Error al convertir la cotización en proyecto.');
        } finally {
          setIsConverting(false);
        }
      }
    });
  };

  // 7. Acciones desde la tabla de historial
  const handleViewProposalFromHistory = async (record: ScopingQuotationRecord) => {
    try {
      const full = await scopingService.getById(record.id);
      setCurrentInputs(full);
      form.setFieldsValue(full);
      setCalculation(full.calculation || null);
      setLastSavedId(full.id);
      setSavedQuoteCode(full.code);
      setProposalModalVisible(true);
    } catch (err) {
      console.error(err);
      message.error('Error al cargar la propuesta seleccionada.');
    }
  };

  const handleDeleteFromHistory = async (id: number) => {
    try {
      await scopingService.delete(id);
      message.success('Levantamiento eliminado correctamente.');
      void loadHistory();
    } catch (err: any) {
      message.error(err.message || 'Error al eliminar.');
    }
  };

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '16px 20px' }}>
      {/* Encabezado del Módulo */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CalculatorOutlined style={{ fontSize: 24, color: token.colorPrimary }} />
          <Title level={3} style={{ margin: 0 }}>
            Cotizador y Protocolo de Levantamiento RPA
          </Title>
        </div>
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0, fontSize: 13 }}>
          Herramienta estandarizada para reuniones de 15 minutos con clientes. Diagnóstico de factibilidad, cubicación cuantitativa de esfuerzo (HH por rol y semanas) y generación de propuesta técnico-económica con ROI.
        </Paragraph>
      </div>

      <Tabs 
        activeKey={activeMainTab}
        onChange={setActiveMainTab}
        items={[
          {
            key: 'wizard',
            label: (
              <span>
                <ThunderboltOutlined />
                Protocolo de 15 Minutos (Nuevo Levantamiento)
              </span>
            ),
            children: (
              <div>
                <MeetingTimerHeader 
                  archetypes={archetypes}
                  selectedArchetypeId={selectedArchetype?.id}
                  onSelectArchetype={handleSelectArchetype}
                  onOpenArchetypeQuestions={() => setArchetypeModalVisible(true)}
                />

                <Form
                  form={form}
                  layout="vertical"
                  initialValues={DEFAULT_INPUTS}
                  onValuesChange={handleFormValuesChange}
                >
                  <Row gutter={[16, 16]}>
                    <Col xs={24} lg={15} xl={16}>
                      <DiscoveryWizard 
                        form={form}
                        inputs={currentInputs}
                        onValuesChange={handleFormValuesChange}
                        selectedArchetype={selectedArchetype}
                      />
                    </Col>

                    <Col xs={24} lg={9} xl={8}>
                      <LiveScoringSidebar 
                        calculation={calculation}
                        loading={isCalculating}
                        onOpenProposal={() => setProposalModalVisible(true)}
                        onSaveQuote={handleSaveQuote}
                        isSaving={isSaving}
                      />
                    </Col>
                  </Row>
                </Form>
              </div>
            )
          },
          {
            key: 'history',
            label: (
              <span>
                <HistoryOutlined />
                Historial de Cotizaciones y Levantamientos
              </span>
            ),
            children: (
              <ScopingListTable 
                items={historyItems}
                kpis={kpis}
                loading={historyLoading}
                onViewProposal={handleViewProposalFromHistory}
                onEdit={(item) => {
                  handleViewProposalFromHistory(item);
                  setActiveMainTab('wizard');
                }}
                onDelete={handleDeleteFromHistory}
                onConvertToProject={(id) => handleConvertToProject(id)}
                onSearchChange={setSearchFilter}
                onStatusFilterChange={setStatusFilter}
                searchValue={searchFilter}
                statusFilter={statusFilter}
                onNewScoping={() => {
                  form.resetFields();
                  setLastSavedId(null);
                  setSelectedArchetype(undefined);
                  setCurrentInputs(DEFAULT_INPUTS);
                  form.setFieldsValue(DEFAULT_INPUTS);
                  triggerCalculate(DEFAULT_INPUTS);
                  setActiveMainTab('wizard');
                }}
              />
            )
          }
        ]}
      />

      {/* Modal de Propuesta Técnico-Económica */}
      {calculation && (
        <TechnicalEconomicProposalModal
          visible={proposalModalVisible}
          onClose={() => setProposalModalVisible(false)}
          inputs={currentInputs}
          calculation={calculation}
          quoteCode={savedQuoteCode}
          onConvertToProject={() => handleConvertToProject()}
          isConverting={isConverting}
        />
      )}

      {/* Modal de Preguntas Guía del Arquetipo */}
      <ScopingArchetypeQuestionsModal 
        visible={archetypeModalVisible}
        onClose={() => setArchetypeModalVisible(false)}
        archetype={selectedArchetype}
      />
    </div>
  );
};

export default ScopingPage;
