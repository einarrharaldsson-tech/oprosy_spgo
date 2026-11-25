export default function Brand({ municipalityName }) {
  const muni = String(municipalityName || '').trim();
  return (
    <div className="brand">
      <span className="brand__name">Реплика</span>
      {muni ? <span className="brand__municipality">{muni}</span> : null}
      <span className="brand__tagline">
        Сервис проведения опросов.{' '}
        <span className="brand__credit">(создано в KT Digital)</span>
      </span>
    </div>
  );
}
