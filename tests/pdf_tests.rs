//! PDF parsing integration tests.
//!
//! Each test follows strict TDD: written first → watched fail → minimal code to pass.

use std::path::PathBuf;

/// A minimal valid 1×1 pixel JPEG (red pixel).
/// Used as test fixture for image extraction tests.
const MINIMAL_JPEG: &[u8] = &[
    0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07,
    0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12, 0x13, 0x0f,
    0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20, 0x22, 0x2c,
    0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27, 0x39, 0x3d,
    0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
    0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    0x07, 0x08, 0x09, 0x0a, 0x0b, 0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02,
    0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04, 0x11,
    0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91,
    0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09,
    0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37,
    0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
    0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77,
    0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96,
    0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
    0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2,
    0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8,
    0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xff, 0xda, 0x00, 0x08,
    0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x7b, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xd9,
];
/// Generate a PDF with an embedded JPEG image on each page.
fn generate_pdf_with_image(page_count: usize) -> Vec<u8> {
    use lopdf::dictionary;
    use lopdf::{Document, Object, ObjectId, Stream};

    let mut doc = Document::with_version("1.4");
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let mut page_ids: Vec<ObjectId> = Vec::new();
    for _ in 0..page_count {
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        let image_id = doc.new_object_id();
        let res_id = doc.new_object_id();

        // Image XObject with JPEG data
        let img_stream = Stream {
            dict: dictionary! {
                "Type" => "XObject",
                "Subtype" => "Image",
                "Width" => Object::Integer(1),
                "Height" => Object::Integer(1),
                "ColorSpace" => "DeviceRGB",
                "BitsPerComponent" => Object::Integer(8),
                "Filter" => "DCTDecode",
                "Length" => Object::Integer(MINIMAL_JPEG.len() as i64),
            },
            content: MINIMAL_JPEG.to_vec(),
            allows_compression: false,
            start_position: None,
        };
        doc.objects.insert(image_id, Object::Stream(img_stream));

        // Content stream: draw the image
        let content_data = b"q 100 0 0 100 100 100 cm /Im0 Do Q".to_vec();
        let content_stream = Stream {
            dict: dictionary! { "Length" => Object::Integer(content_data.len() as i64) },
            content: content_data,
            allows_compression: true,
            start_position: None,
        };
        doc.objects
            .insert(content_id, Object::Stream(content_stream));

        let resources = dictionary! {
            "XObject" => dictionary! { "Im0" => Object::Reference(image_id) },
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
        "Type" => "Pages", "Kids" => kids, "Count" => Object::Integer(page_count as i64),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf)
        .expect("failed to serialize test PDF with image");
    buf
}

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

// ── Test 9: page-level text extraction ────────────────────────────

#[test]
fn test_read_page_returns_page_text() {
    // Create a 2-page PDF with different text on each page
    use lopdf::dictionary;
    use lopdf::{Document, Object, ObjectId, Stream};

    let mut doc = Document::with_version("1.4");
    let font_id = doc.new_object_id();
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();

    let font = dictionary! {
        "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
    };
    doc.objects.insert(font_id, Object::Dictionary(font));

    let page_texts = ["Page One Content", "Page Two Different"];
    let mut page_ids: Vec<ObjectId> = Vec::new();

    for text in &page_texts {
        let page_id = doc.new_object_id();
        let content_id = doc.new_object_id();
        let res_id = doc.new_object_id();

        let content_data = format!("BT /F1 12 Tf 72 700 Td ({text}) Tj ET");
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
            "Type" => "Page", "Parent" => pages_id,
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
        "Type" => "Pages", "Kids" => kids, "Count" => Object::Integer(2),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    let path = write_temp_pdf("two_page.pdf", &buf);

    let doc = agentsense::PdfDocument::open(&path).expect("should open 2-page PDF");
    assert_eq!(doc.page_count(), 2);

    let page1 = doc.read_page(1).expect("should read page 1");
    let page2 = doc.read_page(2).expect("should read page 2");
    assert!(page1.contains("Page One"), "page1: {page1}");
    assert!(page2.contains("Page Two"), "page2: {page2}");
    assert!(
        !page1.contains("Page Two"),
        "page1 should not have page2 text"
    );
}

#[test]
fn test_read_page_out_of_range_returns_error() {
    let pdf_bytes = generate_test_pdf(2);
    let path = write_temp_pdf("range_test.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    assert!(doc.read_page(0).is_err(), "page 0 should error");
    assert!(doc.read_page(3).is_err(), "page 3 should error");
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

// ── Test 11: text() with PdfsinkRs engine ──────────────────────────

#[test]
fn test_text_with_pdfsink_engine() {
    use agentsense::PdfEngine;
    let pdf_bytes = generate_pdf_with_text("PdfsinkRs Text Test", 1);
    let path = write_temp_pdf("pdfsink_text.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::with_engine(&path, PdfEngine::PdfsinkRs)
        .expect("should open with PdfsinkRs");
    let text = doc.text().expect("should extract text");
    assert!(text.contains("PdfsinkRs Text Test"));
}

// ── Test 12: read_page with PdfsinkRs engine ───────────────────────

#[test]
fn test_read_page_with_pdfsink_engine() {
    use agentsense::PdfEngine;
    let pdf_bytes = generate_pdf_with_text("PDFsink Page One", 1);
    let path = write_temp_pdf("pdfsink_page.pdf", &pdf_bytes);

    let doc =
        agentsense::PdfDocument::with_engine(&path, PdfEngine::PdfsinkRs).expect("should open");
    let text = doc.read_page(1).expect("should read page 1");
    assert!(text.contains("PDFsink Page One"));
}

// ── Test 13: PdfsinkRs metadata via lopdf fallback ─────────────────

#[test]
fn test_pdfsink_metadata_fallback_works() {
    use agentsense::PdfEngine;
    let pdf_bytes = generate_pdf_with_metadata("Pdfsink Metadata Test", "Meta Author", 1);
    let path = write_temp_pdf("pdfsink_meta.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::with_engine(&path, PdfEngine::PdfsinkRs)
        .expect("should open with PdfsinkRs");
    let info = doc.info();
    assert_eq!(info.title(), Some("Pdfsink Metadata Test"));
    assert_eq!(info.author(), Some("Meta Author"));
}

// ── Test 14: page_size A4 vs US Letter ─────────────────────────────

#[test]
fn test_page_size_detection() {
    let pdf_bytes = generate_test_pdf(1); // US Letter: 612×792
    let path = write_temp_pdf("letter.pdf", &pdf_bytes);
    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let info = doc.info();
    assert!(
        (info.page_width_pt() - 612.0).abs() < 1.0,
        "US Letter width"
    );
    assert!(
        (info.page_height_pt() - 792.0).abs() < 1.0,
        "US Letter height"
    );
}

// ── Test 15: PdfEngine Debug/Clone/Copy/Eq traits ──────────────────

#[test]
fn test_pdf_engine_traits() {
    let a = agentsense::PdfEngine::Lopdf;
    let b = agentsense::PdfEngine::PdfsinkRs;
    // Copy
    let a2 = a;
    assert_eq!(a2, agentsense::PdfEngine::Lopdf);
    // Clone
    let b2 = b;
    assert_ne!(b2, a);
    // Debug
    assert!(format!("{a:?}").contains("Lopdf"));
    assert!(format!("{b:?}").contains("PdfsinkRs"));
}

// ── Test 16: empty PDF (no info dict) ──────────────────────────────

#[test]
fn test_open_pdf_without_info_dict() {
    // generate_test_pdf creates a PDF with no Info dictionary
    let pdf_bytes = generate_test_pdf(1);
    let path = write_temp_pdf("no_info.pdf", &pdf_bytes);
    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let info = doc.info();
    assert_eq!(info.title(), None);
    assert_eq!(info.author(), None);
    assert_eq!(info.creator(), None);
    assert_eq!(info.page_count(), 1);
    assert!(doc.text().is_ok());
}

// ── Test 17: multi-page text extraction consistency ────────────────

#[test]
fn test_full_text_vs_page_text_consistency() {
    let pdf_bytes = generate_pdf_with_text("Consistency", 2);
    let path = write_temp_pdf("consistency.pdf", &pdf_bytes);
    let doc = agentsense::PdfDocument::open(&path).expect("should open");

    let full = doc.text().expect("full text");
    let p1 = doc.read_page(1).expect("page 1");
    let p2 = doc.read_page(2).expect("page 2");

    // Each page should contain the word
    assert!(p1.contains("Consistency"));
    assert!(p2.contains("Consistency"));
    // Full text should be longer than either individual page
    assert!(full.len() > p1.len());
    assert!(full.len() > p2.len());
}

// ── Test 18: DocumentInfo display/debug ────────────────────────────

#[test]
fn test_document_info_debug_format() {
    let pdf_bytes = generate_pdf_with_metadata("Debug Test", "Debug Author", 1);
    let path = write_temp_pdf("debug_info.pdf", &pdf_bytes);
    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let info = doc.info();
    let debug_str = format!("{info:?}");
    assert!(debug_str.contains("Debug Test"));
    assert!(debug_str.contains("Debug Author"));
}

// ── Test 19: AgentSenseError Display ───────────────────────────────

#[test]
fn test_error_display_messages() {
    let e = agentsense::AgentSenseError::FileNotFound("test.pdf".into());
    assert!(e.to_string().contains("file not found"));
    assert!(e.to_string().contains("test.pdf"));

    let e = agentsense::AgentSenseError::InvalidPdf("bad header".into());
    assert!(e.to_string().contains("invalid PDF"));
    assert!(e.to_string().contains("bad header"));
}

// ── Test 20: PdfDocument Debug format ──────────────────────────────

#[test]
fn test_pdf_document_debug_format() {
    let pdf_bytes = generate_test_pdf(1);
    let path = write_temp_pdf("debug_doc.pdf", &pdf_bytes);
    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let debug_str = format!("{doc:?}");
    // Should contain the struct name and path
    assert!(debug_str.contains("PdfDocument"));
    assert!(debug_str.contains("debug_doc"));
}

// ── Test 21: list images from PDF ─────────────────────────────────

#[test]
fn test_list_images_returns_metadata() {
    let pdf_bytes = generate_pdf_with_image(1);
    let path = write_temp_pdf("image_test.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open image PDF");

    let images = doc.list_images().expect("should list images");
    assert_eq!(images.len(), 1, "should have 1 image");
    let img = &images[0];
    assert_eq!(img.page, 1);
    assert_eq!(img.width, 1);
    assert_eq!(img.height, 1);
    assert!(!img.name.is_empty());
}

// ── Test 22: list images on PDF with no images ────────────────────

#[test]
fn test_list_images_empty_for_text_only_pdf() {
    let pdf_bytes = generate_test_pdf(1);
    let path = write_temp_pdf("no_img.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let images = doc.list_images().expect("should list");
    assert!(images.is_empty(), "text-only PDF should have 0 images");
}

// ── Test 23: extract raw image bytes ──────────────────────────────

#[test]
fn test_extract_image_returns_raw_bytes() {
    let pdf_bytes = generate_pdf_with_image(1);
    let path = write_temp_pdf("extract_img.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let data = doc.extract_image(1, 0).expect("should extract image");

    // JPEG magic bytes
    assert!(
        data.starts_with(&[0xff, 0xd8]),
        "should start with JPEG SOI"
    );
    assert!(data.ends_with(&[0xff, 0xd9]), "should end with JPEG EOI");
}

// ── Test 24: extract image out of range ───────────────────────────

#[test]
fn test_extract_image_out_of_range() {
    let pdf_bytes = generate_pdf_with_image(1);
    let path = write_temp_pdf("img_range.pdf", &pdf_bytes);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    assert!(doc.extract_image(0, 0).is_err(), "page 0 should error");
    assert!(
        doc.extract_image(1, 99).is_err(),
        "image index out of range"
    );
    assert!(doc.extract_image(99, 0).is_err(), "page out of range");
}

// ── Test 25: multi-image page ─────────────────────────────────────

#[test]
fn test_list_multiple_images_per_page() {
    use lopdf::dictionary;
    use lopdf::{Document, Object, Stream};

    let mut doc = Document::with_version("1.4");
    let pages_id = doc.new_object_id();
    let catalog_id = doc.new_object_id();
    let page_id = doc.new_object_id();
    let content_id = doc.new_object_id();
    let res_id = doc.new_object_id();
    let img1_id = doc.new_object_id();
    let img2_id = doc.new_object_id();

    let make_img_stream = || Stream {
        dict: dictionary! {
            "Type" => "XObject", "Subtype" => "Image",
            "Width" => Object::Integer(1), "Height" => Object::Integer(1),
            "ColorSpace" => "DeviceRGB", "BitsPerComponent" => Object::Integer(8),
            "Filter" => "DCTDecode", "Length" => Object::Integer(MINIMAL_JPEG.len() as i64),
        },
        content: MINIMAL_JPEG.to_vec(),
        allows_compression: false,
        start_position: None,
    };
    doc.objects
        .insert(img1_id, Object::Stream(make_img_stream()));
    doc.objects
        .insert(img2_id, Object::Stream(make_img_stream()));

    let content_data =
        b"q 100 0 0 100 100 100 cm /Im0 Do Q q 100 0 0 100 200 200 cm /Im1 Do Q".to_vec();
    let content_stream = Stream {
        dict: dictionary! { "Length" => Object::Integer(content_data.len() as i64) },
        content: content_data,
        allows_compression: true,
        start_position: None,
    };
    doc.objects
        .insert(content_id, Object::Stream(content_stream));

    let resources = dictionary! {
        "XObject" => dictionary! {
            "Im0" => Object::Reference(img1_id),
            "Im1" => Object::Reference(img2_id),
        },
    };
    doc.objects.insert(res_id, Object::Dictionary(resources));

    let page = dictionary! {
        "Type" => "Page", "Parent" => pages_id,
        "MediaBox" => vec![Object::Integer(0), Object::Integer(0),
                           Object::Integer(612), Object::Integer(792)],
        "Contents" => Object::Reference(content_id),
        "Resources" => Object::Reference(res_id),
    };
    doc.objects.insert(page_id, Object::Dictionary(page));

    let pages = dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(page_id)],
        "Count" => Object::Integer(1),
    };
    doc.objects.insert(pages_id, Object::Dictionary(pages));

    let catalog = dictionary! { "Type" => "Catalog", "Pages" => Object::Reference(pages_id) };
    doc.objects.insert(catalog_id, Object::Dictionary(catalog));
    doc.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    doc.save_to(&mut buf).unwrap();
    let path = write_temp_pdf("two_imgs.pdf", &buf);

    let doc = agentsense::PdfDocument::open(&path).expect("should open");
    let images = doc.list_images().expect("should list");
    assert_eq!(images.len(), 2, "should have 2 images");
    assert_eq!(images[0].index, 0);
    assert_eq!(images[1].index, 1);
}
