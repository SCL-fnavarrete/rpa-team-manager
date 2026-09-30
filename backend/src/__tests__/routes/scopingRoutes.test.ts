jest.mock('../../middleware/auth', () => {
  return {
    authenticate: (req: any, _res: any, next: any) => {
      req.user = { id: 1, role: 'rpa_developer', email: 'dev@rpa.com' };
      next();
    }
  };
});

import express from 'express';
import request from 'supertest';
import scopingRoutes from '../../routes/scopingRoutes';
import { RPA_ARCHETYPES } from '../../constants/rpaArchetypes';

const app = express();
app.use(express.json());
app.use('/api/scopings', scopingRoutes);

describe('scopingRoutes API', () => {
  it('GET /api/scopings/archetypes devuelve el catálogo de arquetipos RPA', async () => {
    const res = await request(app).get('/api/scopings/archetypes');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    
    const ids = res.body.data.map((a: any) => a.id);
    expect(ids).toContain('conciliacion_bancaria');
    expect(ids).toContain('contabilizacion_facturas');
    expect(ids).toContain('recepcion_ordenes_compra');
  });

  it('POST /api/scopings/calculate realiza el cálculo en memoria con cubicación y ROI', async () => {
    const payload = {
      data_input_type: 'digital_structured',
      rule_based_level: 'rules_mostly',
      process_stability: 'no_change',
      application_stability: 'no_change',
      frequency: 'daily',
      volume_per_frequency: 200,
      aht_minutes: 8,
      process_steps_count: '25_40',
      decision_complexity: 'simple_yes_no',
      applications_count: '2_3_apps',
      uses_vdi: false,
      requires_ocr: false,
      structured_data_pct: 'gte_80'
    };

    const res = await request(app)
      .post('/api/scopings/calculate')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.is_viable).toBe(true);
    expect(res.body.data.total_hours).toBeGreaterThan(0);
    expect(res.body.data.proposed_price).toBeGreaterThan(0);
    expect(res.body.data.roles_breakdown).toHaveLength(4);
    expect(res.body.data.phases_breakdown).toHaveLength(5);
  });
});
