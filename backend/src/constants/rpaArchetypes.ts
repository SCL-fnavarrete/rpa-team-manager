import { ScopingInputs } from '../services/scopingCalculationEngine';

export interface RPAArchetype {
  id: string;
  name: string;
  category: 'Finanzas' | 'Operaciones' | 'Ventas' | 'TI & Datos';
  description: string;
  typical_systems: string;
  typical_frequency: string;
  typical_benefits: string;
  default_inputs: Partial<ScopingInputs>;
  recommended_questions: string[];
}

export const RPA_ARCHETYPES: RPAArchetype[] = [
  {
    id: 'conciliacion_bancaria',
    name: 'Conciliación Bancaria y Descarga de Cartolas',
    category: 'Finanzas',
    description: 'Descarga automatizada de cartolas bancarias (Santander, Chile, BCI, Itaú, etc.), extracción de transacciones, macheo con libro banco/ERP (SAP, Dynamics 365, Softland) y reporte de partidas pendientes.',
    typical_systems: 'Portales Web Bancarios, ERP (SAP / Dynamics / Softland / Defontana), Planillas Excel',
    typical_frequency: 'Diario o Semanal',
    typical_benefits: 'Ahorro de 2 a 4 horas diarias del equipo de tesorería, cuadratura al día y cero desfase en cierres mensuales.',
    recommended_questions: [
      '¿Cuántos bancos y cuántas cuentas corrientes intervienen en la conciliación?',
      '¿El acceso a los portales bancarios requiere Token físico, Soft-Token o credenciales fijas de consulta?',
      '¿El ERP se opera por aplicación web, cliente Windows (SAP GUI) o Escritorio Remoto / Citrix?',
      '¿Las reglas de macheo (RUT, monto, número de documento, fecha +/- días) están 100% formalizadas en un documento?',
      '¿Qué porcentaje de transacciones son excepcionales (sin referencia clara en la cartola)?'
    ],
    default_inputs: {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 150,
      aht_minutes: 8,
      current_ftes: 2,
      error_rate_pct: 4,
      peak_period: 'regular_peak',
      process_steps_count: '25_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80',
      exception_rate_pct: 5
    }
  },
  {
    id: 'contabilizacion_facturas',
    name: 'Contabilización de Facturas de Proveedores (DTE / FCR)',
    category: 'Finanzas',
    description: 'Recepción de facturas de proveedores desde buzón de correo o portal SII, extracción de cabecera y detalle (PDF/XML), validación contra Órdenes de Compra y HES en ERP, e imputación contable.',
    typical_systems: 'Portal SII / Acepta, Outlook / Gmail, ERP (SAP S/4HANA, Dynamics 365, Softland), Excel Datos Maestros',
    typical_frequency: 'Diario',
    typical_benefits: 'Procesamiento oportuno para aprovechamiento de crédito fiscal, eliminación de multas por facturas traspapeladas y reducción del 95% de digitación manual.',
    recommended_questions: [
      '¿Las facturas llegan en formato XML nativo del SII o principalmente en PDFs de libre formato?',
      '¿Se requiere OCR para PDFs escaneados o imágenes enviadas por proveedores?',
      '¿Existe Orden de Compra previa generada en el ERP para hacer macheo de 3 vías (Factura vs OC vs Recepción)?',
      '¿El ERP está alojado localmente, en la nube web o se accede mediante Citrix / VPN?',
      '¿Cuántas facturas mensuales procesa el equipo y cuál es el promedio de líneas por factura?'
    ],
    default_inputs: {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'very_small',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 250,
      aht_minutes: 9,
      current_ftes: 3,
      error_rate_pct: 5,
      peak_period: 'regular_peak',
      process_steps_count: 'gt_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '4_5_apps',
      uses_vdi: false,
      requires_ocr: true,
      structured_data_pct: '60_80',
      exception_rate_pct: 4
    }
  },
  {
    id: 'recepcion_ordenes_compra',
    name: 'Recepción y Procesamiento de Órdenes de Compra de Clientes',
    category: 'Ventas',
    description: 'Recepción de OC de clientes por email o portal B2B, lectura de líneas de pedido, validación de códigos de producto contra catálogo/Datos Maestros, creación de Pedido de Venta en ERP y acuse de recibo.',
    typical_systems: 'Correo Corporativo (Outlook/Exchange), Excel/BD Datos Maestros, ERP (Módulo Ventas/Distribución)',
    typical_frequency: 'Diario',
    typical_benefits: 'Reducción drástica del tiempo de entrega de pedidos (lead time), despacho más ágil y eliminación de errores de código de producto.',
    recommended_questions: [
      '¿Las órdenes de compra vienen en el cuerpo del correo, en PDF adjunto, Excel o a través de un portal B2B (ej. Walmart, Cencosud, Falabella)?',
      '¿Qué ocurre si el código de producto del cliente no coincide con el código interno de la empresa?',
      '¿Quién valida condiciones comerciales especiales (descuentos, cupo de crédito)?',
      '¿Cuántas OC se reciben en promedio al día o en fechas de alta demanda (Cyber, fin de mes)?'
    ],
    default_inputs: {
      data_input_type: 'digital_unstructured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 80,
      aht_minutes: 12,
      current_ftes: 2,
      error_rate_pct: 4,
      peak_period: 'rare_predictable',
      process_steps_count: '25_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: true,
      structured_data_pct: '60_80',
      exception_rate_pct: 6
    }
  },
  {
    id: 'descarga_portales_web',
    name: 'Descarga Masiva y Monitoreo de Portales Externos (SII, Aduanas, B2B)',
    category: 'Operaciones',
    description: 'Inicio de sesión automático en portales web de terceros, navegación segura, aplicación de filtros de fecha/empresa, descarga masiva de reportes, cartolas o certificados y almacenamiento estructurado.',
    typical_systems: 'Navegadores Web (Chrome, Edge), Portales Estatales / B2B, Directorios Compartidos / OneDrive / SharePoint',
    typical_frequency: 'Diario o Semanal',
    typical_benefits: 'Disponibilidad de información a primera hora (8:00 AM) sin requerir que un colaborador ingrese manualmente antes de su jornada.',
    recommended_questions: [
      '¿El portal web cuenta con medidas antibot o Captcha (Cloudflare, reCAPTCHA v2/v3)?',
      '¿Las credenciales son compartidas o se requiere certificado digital instalado en el equipo?',
      '¿Con qué periodicidad se deben descargar los archivos y dónde deben ser depositados?',
      '¿El portal web sufre caídas de servicio o mantenimientos programados frecuentes?'
    ],
    default_inputs: {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_exclusive',
      process_stability: 'very_small',
      application_stability: 'some_change',
      frequency: 'daily',
      volume_per_frequency: 40,
      aht_minutes: 5,
      current_ftes: 1,
      error_rate_pct: 2,
      peak_period: 'no_peaks',
      process_steps_count: '15_25',
      decision_complexity: 'linear',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80',
      exception_rate_pct: 2
    }
  },
  {
    id: 'carga_masiva_datos',
    name: 'Carga Masiva e Integración de Datos en ERP / Sistemas Legados',
    category: 'TI & Datos',
    description: 'Lectura de planillas de consolidación, validación de integridad referencial, apertura de ventanas en sistema de escritorio/web e ingreso secuencial de registros simulando digitador.',
    typical_systems: 'Excel, Sistemas Legados Desktop (AS/400, cliente cliente-servidor Windows), ERP',
    typical_frequency: 'Semanal o Mensual',
    typical_benefits: 'Evita costosos desarrollos de interfaces/APIs sobre sistemas legados y procesa lotes de miles de registros sin fatiga.',
    recommended_questions: [
      '¿El sistema destino cuenta con validaciones de pantalla o bloqueos por campos obligatorios?',
      '¿Existe ambiente de pruebas (QA/Staging) idéntico a producción para realizar pruebas de carga?',
      '¿Cómo se maneja un registro rechazado durante la carga para no detener el resto del lote?'
    ],
    default_inputs: {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_exclusive',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'weekly',
      volume_per_frequency: 1200,
      aht_minutes: 2,
      current_ftes: 2,
      error_rate_pct: 6,
      peak_period: 'regular_peak',
      process_steps_count: '15_25',
      decision_complexity: 'linear',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80',
      exception_rate_pct: 3
    }
  },
  {
    id: 'custom',
    name: 'Proceso Personalizado / Nuevo Levantamiento',
    category: 'Operaciones',
    description: 'Formulario en blanco para cualquier flujo operativo, administrativo, logístico o comercial no tipificado.',
    typical_systems: 'Sistemas a relevar en la reunión',
    typical_frequency: 'A determinar',
    typical_benefits: 'Automatización y liberación de horas según diagnóstico específico.',
    recommended_questions: [
      '¿Cuál es el objetivo principal del proceso y qué evento lo detona (trigger)?',
      '¿Cuáles son las aplicaciones involucradas y qué nivel de acceso tenemos?',
      '¿Qué porcentaje del proceso sigue reglas fijas y cuánto requiere juicio humano?',
      '¿Cuántas veces se ejecuta al día/mes y cuánto tiempo consume por caso?'
    ],
    default_inputs: {
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
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80',
      exception_rate_pct: 5
    }
  }
];
