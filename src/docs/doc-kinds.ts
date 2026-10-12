export const DOC_KINDS = ['doc', 'sheet', 'slides', 'form', 'mind', 'folder', 'board', 'flow'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const emptySheet = () => ({
  cols: 16,
  rows: Array.from({ length: 40 }, () => Array.from({ length: 16 }, () => '')),
});

export function kindPreset(kind: DocKind, template?: string) {
  if (kind === 'doc' && template === 'meeting') {
    return {
      title: 'Biên bản họp',
      content:
        '<h2>Mục tiêu</h2><p></p><h2>Thành phần</h2><ul><li></li></ul><h2>Nội dung</h2><p></p><h2>Việc cần làm</h2><ul><li></li></ul>',
    };
  }
  if (kind === 'doc' && template === 'weekly') {
    return {
      title: 'Báo cáo tuần',
      content:
        '<h2>Đã làm</h2><ul><li></li></ul><h2>Đang làm</h2><ul><li></li></ul><h2>Vướng mắc</h2><p></p><h2>Kế hoạch tuần sau</h2><ul><li></li></ul>',
    };
  }
  const titles: Record<DocKind, string> = {
    doc: 'Tài liệu không tiêu đề',
    sheet: 'Bảng tính không tiêu đề',
    slides: 'Trang chiếu không tiêu đề',
    form: 'Biểu mẫu không tiêu đề',
    mind: 'MindNotes không tiêu đề',
    folder: 'Thư mục không tiêu đề',
    board: 'Bảng không tiêu đề',
    flow: 'Lưu đồ không tiêu đề',
  };
  const starters: Record<DocKind, string> = {
    doc: '',
    sheet: JSON.stringify(emptySheet()),
    slides: JSON.stringify({ slides: [{ title: 'Trang 1', body: '' }] }),
    form: JSON.stringify({ fields: [{ id: '1', label: 'Câu hỏi 1', type: 'text' }] }),
    mind: JSON.stringify({ text: 'Ý tưởng trung tâm', children: [{ text: '', children: [] }] }),
    folder: '',
    board: JSON.stringify({
      columns: [
        { title: 'Cần làm', cards: [''] },
        { title: 'Đang làm', cards: [] },
        { title: 'Xong', cards: [] },
      ],
    }),
    flow: JSON.stringify({ steps: ['Bắt đầu', 'Bước 2', 'Kết thúc'] }),
  };
  return { title: titles[kind], content: starters[kind] };
}
