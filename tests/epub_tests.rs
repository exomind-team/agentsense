//! EPUB reading integration tests.
//! Uses a pre-built test EPUB in tests/fixtures/test_book.epub (3 chapters).

use std::path::PathBuf;

fn test_epub_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("test_book.epub")
}

#[test]
fn test_epub_open_returns_metadata() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open EPUB");
    assert_eq!(doc.title(), Some("Test Book"));
    assert_eq!(doc.author(), Some("Test Author"));
    assert_eq!(doc.chapter_count(), 3);
}

#[test]
fn test_epub_read_chapter_by_index() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open");

    let ch1 = doc.read_chapter(1).expect("chapter 1");
    assert!(ch1.contains("first chapter"));

    let ch2 = doc.read_chapter(2).expect("chapter 2");
    assert!(ch2.contains("Second chapter has different content"));

    let ch3 = doc.read_chapter(3).expect("chapter 3");
    assert!(ch3.contains("third and final"));
}

#[test]
fn test_epub_chapter_out_of_range() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open");
    assert!(doc.read_chapter(0).is_err(), "chapter 0 should error");
    assert!(doc.read_chapter(99).is_err(), "chapter 99 should error");
}

#[test]
fn test_epub_full_text() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open");
    let text = doc.text().expect("full text");
    assert!(text.contains("first chapter"));
    assert!(text.contains("Second chapter"));
    assert!(text.contains("third and final"));
}

#[test]
fn test_epub_open_nonexistent() {
    let result = agentsense::EpubDocument::open(&PathBuf::from("tests/fixtures/ghost.epub"));
    assert!(result.is_err());
}

#[test]
fn test_epub_toc_returns_tree() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open");
    let toc = doc.toc();
    assert!(!toc.is_empty(), "TOC should not be empty");
    // The test EPUB has "First Chapter", "Second Chapter", "Third Chapter" as navPoints
    let ch_count = toc.iter().filter(|e| e.title.contains("Chapter")).count();
    assert!(
        ch_count >= 3,
        "should have chapter entries, got {} TOC items",
        toc.len()
    );
}

#[test]
fn test_epub_read_toc_entry_by_title() {
    let path = test_epub_path();
    let doc = agentsense::EpubDocument::open(&path).expect("should open");

    // Find chapter 1: "Chapter 1"
    let ch1 = doc
        .toc()
        .iter()
        .find(|e| e.title == "Chapter 1")
        .expect("should find Chapter 1 entry");
    let content = doc.read_toc_entry(ch1).expect("should read");
    assert!(content.contains("first chapter"), "got: {content}");
}
