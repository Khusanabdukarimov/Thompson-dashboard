import { Topbar } from '../components/Topbar';
import { Card } from '../components/Card';

export default function TaqsimotPage() {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <Topbar title="Taqsimot" />
      <div style={{ padding: 24 }}>
        <Card style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          <p style={{ fontSize: 15, marginBottom: 8 }}>Taqsimot sahifasi</p>
          <p style={{ fontSize: 13 }}>Bo'lim liderlariga lead taqsimot ulushlarini sozlash uchun ishlatiladi.</p>
        </Card>
      </div>
    </div>
  );
}
