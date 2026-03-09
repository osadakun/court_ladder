import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseCsvRows,
  validateImportRows,
  type ParsedRow,
  type ValidatedRow,
} from "../../supabase/functions/_shared/core/csv-import.ts";

// ============================================================
// FR-04 CSV パース（v2.6: 学年 + 初期コート列追加）
// ============================================================

Deno.test("FR-04 v2.6 parse: ヘッダー行 + データ2行をパースできる", () => {
  const csv = `形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート
singles,Aチーム,田中 太郎,中3,,,1
doubles,Bチーム,鈴木 花子,中2,山田 次郎,中1,8`;
  const rows = parseCsvRows(csv);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].entryType, "singles");
  assertEquals(rows[0].teamName, "Aチーム");
  assertEquals(rows[0].member1Name, "田中 太郎");
  assertEquals(rows[0].member1Grade, "中3");
  assertEquals(rows[0].member2Name, "");
  assertEquals(rows[0].member2Grade, "");
  assertEquals(rows[0].initialCourtNo, "1");
  assertEquals(rows[1].entryType, "doubles");
  assertEquals(rows[1].member1Name, "鈴木 花子");
  assertEquals(rows[1].member1Grade, "中2");
  assertEquals(rows[1].member2Name, "山田 次郎");
  assertEquals(rows[1].member2Grade, "中1");
  assertEquals(rows[1].initialCourtNo, "8");
});

Deno.test("FR-04 v2.6 parse: 空行をスキップする", () => {
  const csv = `形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート
singles,Aチーム,田中 太郎,中3,,,1

doubles,Bチーム,鈴木 花子,中2,山田 次郎,中1,8`;
  const rows = parseCsvRows(csv);
  assertEquals(rows.length, 2);
});

Deno.test("FR-04 v2.6 parse: 全角スペースをトリムする", () => {
  const csv = `形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート
singles,　Aチーム　,　田中 太郎　,中3,,,1`;
  const rows = parseCsvRows(csv);
  assertEquals(rows[0].teamName, "Aチーム");
  assertEquals(rows[0].member1Name, "田中 太郎");
});

Deno.test("FR-04 v2.6 parse: 行番号が正しく付与される", () => {
  const csv = `形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート
singles,A,田中,中3,,,1
doubles,B,鈴木,中2,山田,中1,8`;
  const rows = parseCsvRows(csv);
  assertEquals(rows[0].rowNo, 2);
  assertEquals(rows[1].rowNo, 3);
});

Deno.test("FR-04 v2.6 parse: ヘッダーのみの場合は空配列", () => {
  const csv = `形式,チーム名,メンバー1氏名,メンバー1学年,メンバー2氏名,メンバー2学年,初期コート`;
  const rows = parseCsvRows(csv);
  assertEquals(rows.length, 0);
});

Deno.test("FR-04 v2.6 parse: 空文字列の場合は空配列", () => {
  const rows = parseCsvRows("");
  assertEquals(rows.length, 0);
});

// ============================================================
// FR-04 CSV バリデーション（v2.6）
// ============================================================

const courtConfig = { singlesCourtCount: 7, doublesCourtCount: 3 };

Deno.test("FR-04 v2.6 validate: シングルス正常行", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "田中 太郎",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result.length, 1);
  assertEquals(result[0].status, "valid");
  assertEquals(result[0].errors.length, 0);
});

Deno.test("FR-04 v2.6 validate: ダブルス正常行", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "doubles",
    teamName: "Bチーム",
    member1Name: "鈴木 花子",
    member1Grade: "中2",
    member2Name: "山田 次郎",
    member2Grade: "中1",
    initialCourtNo: "8",
  }];
  const result = validateImportRows(rows, ["Bチーム"], courtConfig);
  assertEquals(result.length, 1);
  assertEquals(result[0].status, "valid");
});

Deno.test("FR-04 v2.6 validate: 不正な学年 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "田中 太郎",
    member1Grade: "高1",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("学年")), true);
});

Deno.test("FR-04 v2.6 validate: 学年未入力 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "田中",
    member1Grade: "",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("学年")), true);
});

Deno.test("FR-04 v2.6 validate: シングルスがダブルスコートを指定 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "田中",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "8",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("コート")), true);
});

Deno.test("FR-04 v2.6 validate: ダブルスがシングルスコートを指定 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "doubles",
    teamName: "Bチーム",
    member1Name: "鈴木",
    member1Grade: "中2",
    member2Name: "山田",
    member2Grade: "中1",
    initialCourtNo: "3",
  }];
  const result = validateImportRows(rows, ["Bチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("コート")), true);
});

Deno.test("FR-04 v2.6 validate: 初期コート未入力 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "田中",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("コート")), true);
});

Deno.test("FR-04 v2.6 validate: シングルスでメンバー1が空 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "Aチーム",
    member1Name: "",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.length > 0, true);
});

Deno.test("FR-04 v2.6 validate: ダブルスでメンバー2が空 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "doubles",
    teamName: "Bチーム",
    member1Name: "鈴木 花子",
    member1Grade: "中2",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "8",
  }];
  const result = validateImportRows(rows, ["Bチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("メンバー2")), true);
});

Deno.test("FR-04 v2.6 validate: 不正な形式 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "triple" as "singles",
    teamName: "Aチーム",
    member1Name: "田中",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("形式")), true);
});

Deno.test("FR-04 v2.6 validate: 存在しないチーム名 → エラー", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "存在しないチーム",
    member1Name: "田中",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム", "Bチーム"], courtConfig);
  assertEquals(result[0].status, "invalid");
  assertEquals(result[0].errors.some((e: string) => e.includes("チーム")), true);
});

Deno.test("FR-04 v2.6 validate: チーム名が空の場合はチーム無しとして valid", () => {
  const rows: ParsedRow[] = [{
    rowNo: 2,
    entryType: "singles",
    teamName: "",
    member1Name: "田中",
    member1Grade: "中3",
    member2Name: "",
    member2Grade: "",
    initialCourtNo: "1",
  }];
  const result = validateImportRows(rows, ["Aチーム"], courtConfig);
  assertEquals(result[0].status, "valid");
});

Deno.test("FR-04 v2.6 validate: 複数行の混合結果", () => {
  const rows: ParsedRow[] = [
    { rowNo: 2, entryType: "singles", teamName: "A", member1Name: "田中", member1Grade: "中3", member2Name: "", member2Grade: "", initialCourtNo: "1" },
    { rowNo: 3, entryType: "doubles", teamName: "B", member1Name: "鈴木", member1Grade: "中2", member2Name: "", member2Grade: "", initialCourtNo: "8" }, // エラー: メンバー2なし
    { rowNo: 4, entryType: "singles", teamName: "A", member1Name: "山田", member1Grade: "小6", member2Name: "", member2Grade: "", initialCourtNo: "3" },
  ];
  const result = validateImportRows(rows, ["A", "B"], courtConfig);
  assertEquals(result[0].status, "valid");
  assertEquals(result[1].status, "invalid");
  assertEquals(result[2].status, "valid");
});
