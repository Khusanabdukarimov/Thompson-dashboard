import { Topbar } from '@/components/Topbar';

export default function Placeholder({ title, sub }: { title: string; sub?: string }) {
  return (
    <>
      <Topbar title={title} sub={sub ?? 'Tez kunda...'} />
      <div className="flex-1 overflow-y-auto px-[22px] py-[18px] bg-bg flex items-center justify-center">
        <div className="text-center">
          <div className="text-text3 text-[14px] mb-2">{title} sahifasi hali tayyor emas</div>
          <div className="text-text3 text-[12px]">Lidlar analitika sahifasini sinab ko'ring</div>
        </div>
      </div>
    </>
  );
}
