import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
import { useAuthStore } from '../../store/authStore';
import {
  DEFAULT_INPUTS,
  ScopingCurrency,
  affectsCalculation,
  buildScopingInputs,
  normalizeCustomHours,
  ratesForCurrency,
  recordToFormValues
} from '../../utils/scopingInputs';
import { canConvertScoping, canSeeInternalCosts, isLinkedToProject } from '../../utils/scopingPermissions';
import { MeetingTimerHeader } from '../../components/scoping/MeetingTimerHeader';
import { DiscoveryWizard } from '../../components/scoping/DiscoveryWizard';
import { LiveScoringSidebar } from '../../components/scoping/LiveScoringSidebar';
import { TechnicalEconomicProposalModal } from '../../components/scoping/TechnicalEconomicProposalModal';
import { ScopingListTable } from '../../components/scoping/ScopingListTable';
import { ScopingArchetypeQuestionsModal } from '../../components/scoping/ScopingArchetypeQuestionsModal';

const { Title, Paragraph } = Typography;

// Espera tras la última tecla antes de consultar el historial
const SEARCH_DEBOUNCE_MS = 400;

export const ScopingPage: React.FC = () => {
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [form] = Form.useForm();

  const [activeMainTab, setActiveMainTab] = useState<string>('wizard');
  const [archetypes, setArchetypes] = useState<RPAArchetype[]>([]);
  const [archetypeId, setArchetypeId] = useState<string | undefined>();
  const selectedArchetype = useMemo(
    () => archetypes.find((a) => a.id === archetypeId),
    [archetypes, archetypeId]
  );
  const [archetypeModalVisible, setArchetypeModalVisible] = useState<boolean>(false);
  const [customHoursEnabled, setCustomHoursEnabled] = useState<boolean>(false);
  // Cambia al iniciar o cargar un levantamiento: remonta cronómetro y asistente (cronómetro en 0 y Paso 1)
  const [wizardSession, setWizardSession] = useState<number>(0);

  // Estado del cálculo en vivo
  const [currentInputs, setCurrentInputs] = useState<ScopingInputs>(DEFAULT_INPUTS);
  const [calculation, setCalculation] = useState<ScopingCalculationResult | null>(null);
  const [calculationError, setCalculationError] = useState<string | null>(null);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  // Numera los cálculos para descartar respuestas que llegan fuera de orden
  const calculationSeq = useRef<number>(0);

  // Modal de propuesta formal
  const [proposalModalVisible, setProposalModalVisible] = useState<boolean>(false);
  const [savedQuoteCode, setSavedQuoteCode] = useState<string | undefined>();
  // Fecha de creación del levantamiento guardado; sin guardar, la propuesta es un borrador
  const [savedQuoteDate, setSavedQuoteDate] = useState<string | undefined>();
  const [lastSavedId, setLastSavedId] = useState<number | null>(null);
  // Registro del historial que muestra la propuesta; null = la propuesta es la del asistente en curso
  const [historyProposal, setHistoryProposal] = useState<ScopingQuotationRecord | null>(null);
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
  // El campo de búsqueda responde al instante; la consulta usa `appliedSearch`, que llega con retraso
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [appliedSearch, setAppliedSearch] = useState<string>('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | undefined>();

  // Cálculo reactivo: un resultado vigente, o el error del servidor mostrado en el panel
  const triggerCalculate = useCallback(async (inputs: ScopingInputs) => {
    const seq = ++calculationSeq.current;
    setIsCalculating(true);
    try {
      const result = await scopingService.calculate(inputs);
      if (seq !== calculationSeq.current) return;
      setCalculation(result);
      setCalculationError(null);
    } catch (err: any) {
      if (seq !== calculationSeq.current) return;
      // Sin cálculo vigente no se muestran los números anteriores como si siguieran valiendo
      setCalculation(null);
      setCalculationError(err?.message || 'No se pudo calcular la estimación. Revisa los datos e intenta nuevamente.');
    } finally {
      if (seq === calculationSeq.current) setIsCalculating(false);
    }
  }, []);

  // Todas las entradas del formulario, incluidas las de pasos que aún no se visitaron
  const collectInputs = useCallback(
    (): ScopingInputs => buildScopingInputs(form.getFieldsValue(true)),
    [form]
  );

  const refreshPreview = useCallback((recalculate: boolean = true) => {
    const inputs = collectInputs();
    setCurrentInputs(inputs);
    if (recalculate) void triggerCalculate(inputs);
  }, [collectInputs, triggerCalculate]);

  // 1. Calcular el estado inicial y cargar arquetipos
  useEffect(() => {
    refreshPreview();
    const loadArchetypes = async () => {
      try {
        setArchetypes(await scopingService.getArchetypes());
      } catch (err: any) {
        message.error(err?.message || 'No se pudieron cargar las plantillas de proceso.');
      }
    };
    void loadArchetypes();
  }, [refreshPreview]);

  // 2. Cargar historial
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await scopingService.getAll({
        search: appliedSearch || undefined,
        status: statusFilter || undefined
      });
      setHistoryItems(res.data || []);
      if (res.kpis) setKpis(res.kpis);
    } catch (err: any) {
      message.error(err?.message || 'No se pudo cargar el historial de levantamientos.');
    } finally {
      setHistoryLoading(false);
    }
  }, [appliedSearch, statusFilter]);

  useEffect(() => {
    if (activeMainTab === 'history') {
      void loadHistory();
    }
  }, [activeMainTab, loadHistory]);

  const handleSearchChange = (value: string) => {
    setSearchFilter(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setAppliedSearch(value), SEARCH_DEBOUNCE_MS);
  };

  useEffect(() => () => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, []);

  const handleFormValuesChange = (changedValues: Record<string, unknown>) => {
    // Cambiar la moneda reemplaza las tarifas por las de esa moneda (no quedan tarifas en CLP rotuladas como USD)
    if (changedValues.currency) {
      form.setFieldsValue(ratesForCurrency(changedValues.currency as ScopingCurrency));
    }
    // Escribir cliente, notas, etc. actualiza la propuesta pero no recalcula
    refreshPreview(affectsCalculation(changedValues));
  };

  const handleCustomHoursToggle = (enabled: boolean) => {
    setCustomHoursEnabled(enabled);
    if (!enabled) {
      // Los campos se ocultan pero seguirían en el formulario: sin limpiarlos se calcularía y guardaría con ellos
      form.setFieldValue('custom_hours', undefined);
      refreshPreview();
    }
  };

  // 4. Seleccionar un arquetipo
  const handleSelectArchetype = (archetype: RPAArchetype) => {
    setArchetypeId(archetype.id);
    form.setFieldsValue({
      process_archetype: archetype.id,
      process_name: archetype.name,
      applications_detail: archetype.typical_systems,
      ...archetype.default_inputs
    });
    refreshPreview();
    message.success(`Plantilla cargada: ${archetype.name}`);
  };

  // 5. Guardar cotización en la base de datos
  const handleSaveQuote = async () => {
    try {
      await form.validateFields();
    } catch (err: any) {
      // Los campos de pasos ocultos también se validan: se dice cuál falta
      const firstError = err?.errorFields?.[0]?.errors?.[0];
      message.error(
        firstError
          ? `Por favor completa los campos requeridos antes de guardar: ${firstError}`
          : 'Por favor completa los campos requeridos antes de guardar.'
      );
      return;
    }

    setIsSaving(true);
    try {
      // Mismas entradas que vio el panel: el conjunto completo, nunca solo lo que se montó
      const payload = collectInputs();

      let savedRecord: ScopingQuotationRecord;
      if (lastSavedId) {
        savedRecord = await scopingService.update(lastSavedId, payload);
        message.success(`Cotización ${savedRecord.code} actualizada exitosamente.`);
      } else {
        savedRecord = await scopingService.create(payload);
        setLastSavedId(savedRecord.id);
        message.success(`Cotización ${savedRecord.code} guardada exitosamente.`);
      }

      setSavedQuoteCode(savedRecord.code);
      setSavedQuoteDate(savedRecord.created_at);
      setHistoryProposal(null);
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
      content: 'Se creará el proyecto en el portafolio, en etapa de cotización, con la versión 1 de la cotización lista para aprobar, su tablero Kanban y las 5 fases metodológicas de RPA asignadas como tareas.',
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
      if (!full.calculation) {
        message.warning('Los datos guardados de este levantamiento no permiten calcular su propuesta. Edítalo para corregirlos.');
        return;
      }
      // Solo se muestra: el formulario del asistente en curso no se toca
      setHistoryProposal(full);
      setProposalModalVisible(true);
    } catch (err: any) {
      message.error(err?.message || 'Error al cargar la propuesta seleccionada.');
    }
  };

  // Carga el registro completo en el asistente: arquetipo, interruptores y calibración manual incluidos
  const loadRecordIntoWizard = (record: ScopingQuotationRecord) => {
    form.resetFields();
    form.setFieldsValue(recordToFormValues(record));
    setCustomHoursEnabled(normalizeCustomHours(record.custom_hours) !== null);
    setArchetypeId(record.process_archetype);
    setLastSavedId(record.id);
    setSavedQuoteCode(record.code);
    setSavedQuoteDate(record.created_at);
    setHistoryProposal(null);
    setWizardSession((n) => n + 1);
    // Sin números ni error de la sesión anterior mientras calcula el nuevo registro
    setCalculation(null);
    setCalculationError(null);
    refreshPreview();
  };

  const handleEditFromHistory = async (record: ScopingQuotationRecord) => {
    try {
      const full = await scopingService.getById(record.id);
      loadRecordIntoWizard(full);
      setActiveMainTab('wizard');
    } catch (err: any) {
      message.error(err?.message || 'Error al cargar el levantamiento seleccionado.');
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

  const handleNewScoping = () => {
    form.resetFields();
    setLastSavedId(null);
    setSavedQuoteCode(undefined);
    setSavedQuoteDate(undefined);
    setHistoryProposal(null);
    setArchetypeId(undefined);
    setCustomHoursEnabled(false);
    setWizardSession((n) => n + 1);
    // Sin números ni error de la sesión anterior mientras calcula el levantamiento nuevo
    setCalculation(null);
    setCalculationError(null);
    refreshPreview();
    setActiveMainTab('wizard');
  };

  const handleOpenWizardProposal = () => {
    setHistoryProposal(null);
    setProposalModalVisible(true);
  };

  // Lo que muestra la propuesta: el registro del historial, o el asistente en curso
  const proposal = historyProposal?.calculation
    ? {
        inputs: historyProposal as ScopingInputs,
        calculation: historyProposal.calculation,
        code: historyProposal.code,
        date: historyProposal.created_at,
        id: historyProposal.id,
        converted: isLinkedToProject(historyProposal)
      }
    : calculation
      ? { inputs: currentInputs, calculation, code: savedQuoteCode, date: savedQuoteDate, id: lastSavedId, converted: false }
      : null;
  // Convertir exige permiso y un levantamiento guardado que aún no se haya convertido
  const proposalId = proposal && !proposal.converted && canConvertScoping(user) ? proposal.id : null;

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
                  key={`timer-${wizardSession}`}
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
                        key={`wizard-${wizardSession}`}
                        form={form}
                        inputs={currentInputs}
                        onValuesChange={handleFormValuesChange}
                        selectedArchetype={selectedArchetype}
                        customHoursEnabled={customHoursEnabled}
                        onCustomHoursToggle={handleCustomHoursToggle}
                      />
                    </Col>

                    <Col xs={24} lg={9} xl={8}>
                      <LiveScoringSidebar
                        calculation={calculation}
                        loading={isCalculating}
                        error={calculationError}
                        onRetry={() => refreshPreview()}
                        onOpenProposal={handleOpenWizardProposal}
                        onSaveQuote={handleSaveQuote}
                        isSaving={isSaving}
                        showInternalCosts={canSeeInternalCosts(user)}
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
                onEdit={handleEditFromHistory}
                onDelete={handleDeleteFromHistory}
                onConvertToProject={(id) => handleConvertToProject(id)}
                onSearchChange={handleSearchChange}
                onStatusFilterChange={setStatusFilter}
                searchValue={searchFilter}
                statusFilter={statusFilter}
                onNewScoping={handleNewScoping}
                currentUser={user}
              />
            )
          }
        ]}
      />

      {/* Modal de Propuesta Técnico-Económica */}
      {proposal && (
        <TechnicalEconomicProposalModal
          visible={proposalModalVisible}
          onClose={() => setProposalModalVisible(false)}
          inputs={proposal.inputs}
          calculation={proposal.calculation}
          quoteCode={proposal.code}
          quoteDate={proposal.date}
          onConvertToProject={proposalId ? () => handleConvertToProject(proposalId) : undefined}
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
