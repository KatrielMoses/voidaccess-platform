"""Guarantee 1 in the small: nothing registered can be written through the wrapped streams or the logging module."""
import io
import logging
import sys

from cloud import scrub

QUERY = "stealer logs for acme-corp payroll"
SECRET = "callback-secret-0123456789abcdef"


def test_registered_values_are_replaced_in_text_case_insensitively():
    scrub.register(QUERY)
    scrub.register(SECRET)
    assert scrub.scrub(f"q={QUERY.upper()} s={SECRET}") == "q=[redacted] s=[redacted]"
    assert scrub.scrub("nothing to hide") == "nothing to hide"
    assert scrub.contains_secret(f"x {SECRET} y")


def test_short_strings_are_not_registered():
    scrub.register("the")
    assert scrub.scrub("the cat") == "the cat"


def test_streams_and_logging_are_scrubbed_end_to_end(capsys):
    scrub.register(QUERY)
    scrub.register(SECRET)
    scrub.install_stream_scrubbers()
    try:
        print(f"refining {QUERY} with {SECRET}")
        print(f"to stderr: {QUERY}", file=sys.stderr)
        stream = io.StringIO()
        logger = logging.getLogger("va.test.leak")
        logger.setLevel(logging.DEBUG)
        handler = logging.StreamHandler(stream)
        logger.addHandler(handler)
        logger.error("query was %s", QUERY)
        try:
            raise ValueError(f"bad query {QUERY} {SECRET}")
        except ValueError:
            logger.exception("scrape failed for %s", QUERY)
        logger.removeHandler(handler)
        out = capsys.readouterr()
        everything = out.out + out.err + stream.getvalue()
    finally:
        scrub.uninstall_stream_scrubbers()
    assert QUERY not in everything and SECRET not in everything
    assert QUERY.lower() not in everything.lower() and "[redacted]" in everything
    assert "ValueError" in stream.getvalue()  # the exception type survives, its text does not
