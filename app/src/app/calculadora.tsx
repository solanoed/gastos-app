import { useState } from 'react';
import { View } from 'react-native';

import { Card, Chip, Divider, Field, Input, Row, Screen, SectionTitle, Segmented, Txt } from '@/components/ui';
import { listCards } from '@/db/repo';
import { useData } from '@/hooks/use-data';
import { useTheme } from '@/hooks/use-theme';
import { evaluate } from '@/lib/calc';
import { eaToMonthly, simulate } from '@/lib/finance';
import { money, parseAmount } from '@/lib/format';

const COMPARE = [1, 3, 6, 12, 24, 36];

export default function Calculadora() {
  const [mode, setMode] = useState<'cuotas' | 'basica'>('cuotas');
  return (
    <Screen>
      <Segmented
        options={[
          { value: 'cuotas', label: 'Simular cuotas' },
          { value: 'basica', label: 'Calculadora' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'cuotas' ? <Simulator /> : <Basic />}
    </Screen>
  );
}

function Simulator() {
  const t = useTheme();
  const { data: cards } = useData((db) => listCards(db), []);
  const [amountText, setAmountText] = useState('');
  const [rateText, setRateText] = useState('');
  const [cardId, setCardId] = useState<number | null>(null);
  const [n, setN] = useState(12);

  const amount = parseAmount(amountText) ?? 0;
  const ea = parseFloat(rateText.replace(',', '.')) || 0;
  const sim = amount ? simulate(amount, n, ea) : null;

  return (
    <>
      <Field label="Valor de la compra" hint={amount ? money(amount) : 'Ej: 2m, 850k'}>
        <Input big value={amountText} onChangeText={setAmountText} placeholder="$0" />
      </Field>
      {cards?.length ? (
        <Field label="Usar la tasa de una tarjeta">
          <Row style={{ flexWrap: 'wrap' }}>
            {cards.map((c) => (
              <Chip
                key={c.id}
                label={`${c.name} · ${String(c.ea_rate).replace('.', ',')}%`}
                icon="credit-card"
                color={c.color}
                selected={cardId === c.id}
                onPress={() => {
                  setCardId(c.id);
                  setRateText(String(c.ea_rate).replace('.', ','));
                }}
              />
            ))}
          </Row>
        </Field>
      ) : null}
      <Field label="Tasa E.A. (%)" hint={ea ? `${(eaToMonthly(ea) * 100).toFixed(2).replace('.', ',')}% mensual` : 'Ej: 28,5'}>
        <Input
          value={rateText}
          onChangeText={(v) => {
            setRateText(v);
            setCardId(null);
          }}
          keyboardType="decimal-pad"
          placeholder="28,5"
        />
      </Field>
      <Field label="Cuotas">
        <Row style={{ flexWrap: 'wrap' }}>
          {COMPARE.map((k) => (
            <Chip key={k} label={String(k)} selected={n === k} onPress={() => setN(k)} />
          ))}
          <Input value={String(n)} onChangeText={(v) => setN(Math.max(1, Math.min(120, parseInt(v, 10) || 1)))} keyboardType="number-pad" style={{ width: 70, paddingVertical: 8 }} />
        </Row>
      </Field>

      {sim ? (
        <>
          <Card style={{ backgroundColor: t.infoSoft, borderColor: t.infoSoft }}>
            <Txt variant="small" color={t.info} bold>
              Pagarías al mes
            </Txt>
            <Txt variant="amount" color={t.info}>
              {money(sim.payment)}
            </Txt>
            <Txt color={t.info}>
              Total {money(sim.total)} · intereses {money(sim.interest)}
            </Txt>
            {n === 1 ? (
              <Txt variant="caption" color={t.info}>
                A 1 cuota normalmente no se cobran intereses.
              </Txt>
            ) : null}
          </Card>

          <SectionTitle title="Comparar" />
          <Card>
            <Row>
              <Txt variant="caption" bold muted style={{ width: 54 }}>
                Cuotas
              </Txt>
              <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
                Cuota/mes
              </Txt>
              <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
                Intereses
              </Txt>
              <Txt variant="caption" bold muted style={{ flex: 1, textAlign: 'right' }}>
                Total
              </Txt>
            </Row>
            <Divider />
            {COMPARE.map((k) => {
              const s = simulate(amount, k, ea);
              return (
                <Row key={k} style={k === n ? { backgroundColor: t.primarySoft, borderRadius: 6 } : undefined}>
                  <Txt variant="small" style={{ width: 54 }} bold={k === n}>
                    {k}
                  </Txt>
                  <Txt variant="small" style={{ flex: 1, textAlign: 'right' }}>
                    {money(s.payment)}
                  </Txt>
                  <Txt variant="small" style={{ flex: 1, textAlign: 'right' }} color={s.interest > 0 ? t.danger : t.textSecondary}>
                    {money(s.interest)}
                  </Txt>
                  <Txt variant="small" style={{ flex: 1, textAlign: 'right' }}>
                    {money(s.total)}
                  </Txt>
                </Row>
              );
            })}
          </Card>
          <Txt variant="caption" muted>
            Cálculo con cuota fija y tasa mensual equivalente a la E.A. Tu banco puede variar algunos pesos.
          </Txt>
        </>
      ) : null}
    </>
  );
}

function Basic() {
  const t = useTheme();
  const [expr, setExpr] = useState('');
  const [history, setHistory] = useState<{ expr: string; value: string }[]>([]);
  let result: string | null = null;
  let error: string | null = null;
  if (expr.trim()) {
    try {
      const v = evaluate(expr);
      result = Number.isInteger(v) ? money(v) : (Math.round(v * 100) / 100).toString().replace('.', ',');
    } catch (e) {
      error = (e as Error).message;
    }
  }

  return (
    <>
      <Field label="Expresión" hint="Usa + − * / ^ % y paréntesis. Montos como 32k o 1,5m funcionan.">
        <Input
          value={expr}
          onChangeText={setExpr}
          placeholder="32k*3 + 15000"
          autoFocus
          onSubmitEditing={() => result && (setHistory((h) => [{ expr, value: result! }, ...h].slice(0, 20)), setExpr(''))}
          returnKeyType="done"
        />
      </Field>
      <Card>
        <Txt variant="amount" color={error ? t.textSecondary : t.text}>
          {result ?? '0'}
        </Txt>
        {error && expr.trim() ? (
          <Txt variant="caption" muted>
            {error}
          </Txt>
        ) : null}
      </Card>
      {history.length ? (
        <View style={{ gap: 6 }}>
          {history.map((h, i) => (
            <Row key={i} between>
              <Txt muted>{h.expr}</Txt>
              <Txt bold>{h.value}</Txt>
            </Row>
          ))}
        </View>
      ) : null}
    </>
  );
}
