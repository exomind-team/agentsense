//! PDF parsing integration tests.
//!
//! Each test follows strict TDD: written first → watched fail → minimal code to pass.

use std::path::PathBuf;

/// Generate a minimal valid PDF with the given number of blank pages.
/// This is a pure-Rust test helper using lopdf — no external PDF files needed.
fn generate_test_pdf(page_count: usize) -> Vec<u8> {
    use lopdf::dictionary;
    use lopdf::{Document, Object, ObjectId};

    let mut doc = Document::with_version("1.4");

    // Create the page tree root
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let mut page_ids: Vec<ObjectId> = Vec::new();
    for _ in 0..page_count {
        let page_id = doc.new_object_id();
        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(612),
                Object::Integer(792),
            ],
        };
        doc.objects.insert(page_id, Object::Dictionary(page));
        page_ids.push(page_id);
    }

    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => kids,
        "Count" => Object::Integer(page_count as i64),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).expect("failed to serialize test PDF");
    buf
}

/// Write PDF bytes to a temp file and return the path.
fn write_temp_pdf(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join(name);
    std::fs::write(&path, bytes).expect("failed to write test PDF");
    path
}

// ── Test helper: PDF with metadata ────────────────────────────────

fn generate_pdf_with_metadata(title: &str, author: &str, page_count: usize) -> Vec<u8> {
    use lopdf::dictionary;
    use lopdf::{Document, Object, ObjectId};

    let mut doc = Document::with_version("1.4");

    let info_id = doc.new_object_id();
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    // Info dictionary
    let info = dictionary! {
        "Title" => Object::string_literal(title),
        "Author" => Object::string_literal(author),
        "Creator" => Object::string_literal("AgentSense Test Suite"),
    };
    doc.objects.insert(info_id, Object::Dictionary(info));

    // Pages
    let mut page_ids: Vec<ObjectId> = Vec::new();
    for _ in 0..page_count {
        let page_id = doc.new_object_id();
        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ],
        };
        doc.objects.insert(page_id, Object::Dictionary(page));
        page_ids.push(page_id);
    }

    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => kids,
        "Count" => Object::Integer(page_count as i64),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", catalog_id);
    doc.trailer.set("Info", info_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).expect("failed to serialize test PDF");
    buf
}

// ── Test helper: PDF with text content ──────────────────────────────

fn generate_pdf_with_text(text: &str, page_count: usize) -> Vec<u8> {
    use lopdf::dictionary;
    use lopdf::{Document, Object, ObjectId, Stream};

    let mut doc = Document::with_version("1.4");

    let font_id = doc.new_object_id();
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let font = dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    };
    doc.objects.insert(font_id, Object::Dictionary(font));

    let mut page_ids: Vec<ObjectId> = Vec::new();
    for _ in 0..page_count {
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        let res_id = doc.new_object_id();

        let content_data = format!("BT /F1 12 Tf 72 700 Td ({}) Tj ET", text);
        let content_stream = Stream {
            dict: dictionary! { "Length" => Object::Integer(content_data.len() as i64) },
            content: content_data.into_bytes(),
            allows_compression: true,
            start_position: None,
        };
        doc.objects
            .insert(content_id, Object::Stream(content_stream));

        let resources = dictionary! {
            "Font" => dictionary! { "F1" => Object::Reference(font_id) },
        };
        doc.objects.insert(res_id, Object::Dictionary(resources));

        let page = dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![Object::Integer(0), Object::Integer(0),
                               Object::Integer(612), Object::Integer(792)],
            "Contents" => Object::Reference(content_id),
            "Resources" => Object::Reference(res_id),
        };
        doc.objects.insert(page_id, Object::Dictionary(page));
        page_ids.push(page_id);
    }

    let kids: Vec<Object> = page_ids.iter().map(|id| Object::Reference(*id)).collect();
    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => kids,
        "Count" => Object::Integer(page_count as i64),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).expect("failed to serialize test PDF");
    buf
}

// ── Test 1: open PDF and get page count ──────────────────────────

#[test]
fn test_open_pdf_returns_page_count() {
    let pdf_bytes = generate_test_pdf(3);
    let path = write_temp_pdf("3pages.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open valid PDF");

    assert_eq!(doc.page_count(), 3);
}

// ── Test 2: read document metadata ───────────────────────────────

#[test]
fn test_read_metadata_returns_title_and_author() {
    let pdf_bytes = generate_pdf_with_metadata("Test Title", "Test Author", 1);
    let path = write_temp_pdf("metadata.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open metadata PDF");

    let info = doc.info();
    assert_eq!(info.title(), Some("Test Title"));
    assert_eq!(info.author(), Some("Test Author"));
    assert_eq!(info.page_count(), 1);
}

// ── Test 6: expanded metadata (creator, producer, page size) ──────

#[test]
fn test_read_expanded_metadata() {
    use lopdf::dictionary;
    use lopdf::{Document, Object};

    let mut doc = Document::with_version("1.7");
    let info_id = doc.new_object_id();
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();
    let page_id = doc.new_object_id();

    let info = dictionary! {
        "Title" => Object::string_literal("Rich Metadata PDF"),
        "Author" => Object::string_literal("Test Author"),
        "Creator" => Object::string_literal("AgentSense Test Suite"),
        "Producer" => Object::string_literal("lopdf 0.40"),
        "Subject" => Object::string_literal("Testing metadata extraction"),
        "Keywords" => Object::string_literal("rust, pdf, test"),
    };
    doc.objects.insert(info_id, Object::Dictionary(info));

    let page = dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "MediaBox" => vec![Object::Integer(0), Object::Integer(0),
                           Object::Integer(595), Object::Integer(842)],
    };
    doc.objects.insert(page_id, Object::Dictionary(page));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! {
        "Type" => "Catalog",
        "Pages" => Object::Reference(pages_id),
    };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));

    doc.trailer.set("Root", catalog_id);
    doc.trailer.set("Info", info_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    let path = write_temp_pdf("rich_metadata.pdf", &buf);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let info = doc.info();

    assert_eq!(info.title(), Some("Rich Metadata PDF"));
    assert_eq!(info.author(), Some("Test Author"));
    assert_eq!(info.creator(), Some("AgentSense Test Suite"));
    assert_eq!(info.producer(), Some("lopdf 0.40"));
    assert_eq!(info.subject(), Some("Testing metadata extraction"));
    assert_eq!(info.keywords(), Some("rust, pdf, test"));
    assert_eq!(info.page_count(), 1);
    // A4 page: 595pt × 842pt
    assert!((info.page_width_pt() - 595.0).abs() < 1.0);
    assert!((info.page_height_pt() - 842.0).abs() < 1.0);
}

// ── Test 7: engine abstraction — explicit engine selection ─────────

#[test]
fn test_engine_selection_lopdf_works() {
    use agentsense::PdfEngine;

    let pdf_bytes = generate_test_pdf(2);
    let path = write_temp_pdf("engine_test.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::with_engine(&path, PdfEngine::Lopdf)
        .expect("should open with Lopdf engine");

    assert_eq!(doc.page_count(), 2);
}

#[test]
fn test_engine_selection_pdfsink_works() {
    use agentsense::PdfEngine;

    let pdf_bytes = generate_test_pdf(1);
    let path = write_temp_pdf("pdfsink_test.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::with_engine(&path, PdfEngine::PdfsinkRs)
        .expect("should open with PdfsinkRs engine");

    assert_eq!(doc.page_count(), 1);
}

// ── Test 3: extract text from PDF ─────────────────────────────────

#[test]
fn test_extract_text_returns_content() {
    let pdf_bytes = generate_pdf_with_text("Hello World", 1);
    let path = write_temp_pdf("hello.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open text PDF");

    let text = doc.text().expect("should extract text");
    assert!(
        text.contains("Hello World"),
        "Expected text to contain 'Hello World', got: {text}"
    );
}

// ── Test 4: error handling ────────────────────────────────────────

#[test]
fn test_open_nonexistent_file_returns_error() {
    let path = PathBuf::from("tests/fixtures/does_not_exist.pdf");
    let result = agentsense::PdfDocument::open(&path);
    assert!(result.is_err(), "expected error for missing file");
    let err = result.unwrap_err().to_string();
    assert!(
        err.contains("not found") || err.contains("No such file"),
        "error message should mention missing file, got: {err}"
    );
}

#[test]
fn test_open_invalid_file_returns_error() {
    let path = write_temp_pdf("junk.pdf", b"this is not a PDF file");
    let result = agentsense::PdfDocument::open(&path);
    assert!(result.is_err(), "expected error for invalid PDF");
}
